import type { Message } from "@ag-ui/core";
import { eq, sql } from "drizzle-orm";
import { mastra } from "@/app/mastra";
import { getDb } from "@/lib/db";
import { recentCodes, tutorCodes, userChats } from "@/lib/db/schema";

// Read-side queries (and the destructive delete) behind "Tutor Code Stats".
//
// The data lives across BOTH the app-owned `novedu_*` tables and Mastra's
// `mastra_*` tables, joined BY VALUE — the sanctioned cross-table pattern
// (docs/tutor-codes.md): `mastra_threads.resourceId` = the tutor code,
// `mastra_messages.thread_id` = the thread, `novedu_user_chats.thread_id` ties a
// thread to a student (only for `anonymous: false` tutors). Mastra owns its
// schema, so we only ever READ those tables with raw by-value SQL — never
// declare them to Drizzle (that would make `db:generate` try to migrate them).
// The one MUTATION of Mastra data, deleting a code's conversations, goes through
// Mastra's OWN storage API (`deleteThread`), so we still never touch its schema.
//
// "Interaction" / "conversation" throughout means a Mastra thread that has at
// least one `role = 'user'` message — a chat a student actually wrote into, not
// one merely opened. (`mastra_messages.role` is only ever 'user' or
// 'assistant' for the tutor agent; there are no tools.)
//
// SERVER-ONLY: uses the database and the Mastra store. Never import from client
// components.

// Thread ids are server-generated UUIDs; this guards the value before it reaches
// a query, mirroring the pattern in user-chat-store / the runtime route.
const THREAD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * How many qualifying conversations each of the given codes has, as a map from
 * code to count (codes with none are simply absent → treat as 0). Backs the
 * "Conversations" column on the Shared Tutor Codes list, so it takes the whole
 * set of a teacher's codes in one round trip. Returns `undefined` on a database
 * error (the list then shows the count as unavailable). Never throws.
 */
export async function getInteractionCounts(
  codes: string[],
): Promise<Map<string, number> | undefined> {
  if (codes.length === 0) return new Map();
  try {
    const inList = sql.join(
      codes.map((code) => sql`${code}`),
      sql`, `,
    );
    const res = await getDb().execute<{ code: string; interactions: number }>(sql`
      SELECT t.resourceId AS code, COUNT(*) AS interactions
      FROM mastra_threads t
      WHERE t.resourceId IN (${inList})
        AND EXISTS (
          SELECT 1 FROM mastra_messages m
          WHERE m.thread_id = t.id AND m.role = 'user'
        )
      GROUP BY t.resourceId
    `);
    const counts = new Map<string, number>();
    for (const row of res.recordset) counts.set(row.code, Number(row.interactions));
    return counts;
  } catch (error) {
    console.error("tutor-stats-store: counting interactions failed", error);
    return undefined;
  }
}

/** One conversation in a code's stats. */
export interface Interaction {
  threadId: string;
  /** Timestamp of the first message in the conversation (user or assistant). */
  firstAt: Date;
  /** Timestamp of the last message in the conversation (user or assistant). */
  lastAt: Date;
  /** Number of `role = 'user'` messages — always ≥ 1 (that is what qualifies). */
  userMessageCount: number;
  /**
   * The student's Entra `sub`, if recorded AND the code is non-anonymous.
   * `getTutorCodeStats` forces this to `null` for anonymous codes (see there),
   * so a thread is attributable here only for an `anonymous: false` tutor.
   */
  userId: string | null;
}

/** The detailed stats for a single tutor code. */
export interface TutorCodeStats {
  /** Number of qualifying conversations. */
  conversations: number;
  /**
   * Distinct students with at least one conversation. Always `0` for anonymous
   * codes — `getTutorCodeStats` zeroes it there, so it is meaningful only for
   * `anonymous: false` tutors.
   */
  studentCount: number;
  /** The conversations themselves, newest activity first. */
  interactions: Interaction[];
}

/**
 * Detailed stats for one code: every qualifying conversation with its first/last
 * message time, user-message count, and (when recorded) the student. Returns
 * `undefined` on a database error. Never throws. Authorization (does this code
 * belong to the asking teacher?) is the caller's job — see `getOwnedTutorCode`.
 *
 * `anonymous` is the code's FROZEN flag (`novedu_tutor_codes.anonymous`). When it
 * is `true` this enforces the anonymity promise AT THE DATA LAYER: every
 * `userId` comes back `null` and `studentCount` is `0`, so a caller cannot
 * surface who a student is even by mistake — not even for the documented edge
 * case where `novedu_user_chats` holds rows because the tutor YAML was toggled
 * to non-anonymous AFTER the code was minted (the live attribution flag and this
 * frozen display flag are read separately; see docs/tutor-codes.md). The UI's
 * own `!anonymous` gating is now belt-and-braces on top of this.
 */
export async function getTutorCodeStats(
  code: string,
  anonymous: boolean,
): Promise<TutorCodeStats | undefined> {
  try {
    const res = await getDb().execute<{
      threadId: string;
      firstAt: Date;
      lastAt: Date;
      userMessageCount: number;
      userId: string | null;
    }>(sql`
      SELECT
        t.id AS threadId,
        MIN(m.createdAt) AS firstAt,
        MAX(m.createdAt) AS lastAt,
        SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS userMessageCount,
        uc.user_id AS userId
      FROM mastra_threads t
      JOIN mastra_messages m ON m.thread_id = t.id
      LEFT JOIN novedu_user_chats uc ON uc.thread_id = t.id
      WHERE t.resourceId = ${code}
      GROUP BY t.id, uc.user_id
      HAVING SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) >= 1
      ORDER BY MAX(m.createdAt) DESC
    `);

    const interactions: Interaction[] = res.recordset.map((row) => ({
      threadId: row.threadId,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
      userMessageCount: Number(row.userMessageCount),
      // Anonymous code → never emit the student id, whatever the join returned.
      userId: anonymous ? null : (row.userId ?? null),
    }));

    // Distinct recorded students. A student who opened several conversations
    // counts once; anonymous conversations (userId null) count toward none. For
    // an anonymous code every userId is null above, so this is 0.
    const students = new Set<string>();
    for (const i of interactions) if (i.userId) students.add(i.userId);

    return { conversations: interactions.length, studentCount: students.size, interactions };
  } catch (error) {
    console.error("tutor-stats-store: loading code stats failed", error);
    return undefined;
  }
}

// A stored Mastra message: the v2 UIMessage envelope. The top-level `content`
// string is sometimes absent, so the text is rebuilt from `parts` instead.
interface StoredMessageContent {
  parts?: Array<
    | { type: "text"; text?: string }
    // Image attachments are stored as a `file` part whose `data` is a data: URL.
    | { type: "file"; data?: string; url?: string }
    | { type: string; [key: string]: unknown }
  >;
}

// Turns one stored row into the AG-UI message the chat renderer consumes. Text
// is concatenated from all text parts; image (`file`) parts become AG-UI image
// parts so the teacher sees the same attachments the student sent. Assistant
// messages are plain text (the tutor agent emits no images or tool calls).
function toAguiMessage(row: { id: string; role: string; content: string }): Message | null {
  let parsed: StoredMessageContent;
  try {
    parsed = JSON.parse(row.content) as StoredMessageContent;
  } catch {
    return null;
  }
  const parts = parsed.parts ?? [];
  const text = parts
    .filter((p): p is { type: "text"; text?: string } => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");

  if (row.role === "assistant") {
    return { id: row.id, role: "assistant", content: text };
  }
  if (row.role === "user") {
    const images = parts
      .filter((p): p is { type: "file"; data?: string; url?: string } => p.type === "file")
      .map((p) => p.data ?? p.url)
      .filter((src): src is string => typeof src === "string");
    if (images.length === 0) {
      return { id: row.id, role: "user", content: text };
    }
    // Mixed content: the text plus each attached image, rendered inline. The
    // data: URL goes in straight as a URL source (an <img src> renders it).
    return {
      id: row.id,
      role: "user",
      content: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...images.map((value) => ({
          type: "image" as const,
          source: { type: "url" as const, value },
        })),
      ],
    };
  }
  // Any other role (system/developer/tool) is not part of a tutor chat — skip.
  return null;
}

/**
 * The messages of one conversation, oldest first, as AG-UI messages ready for
 * `CopilotChatMessageView`. The `code` is required and re-checked against the
 * thread's `resourceId` (defense in depth on top of the caller's ownership
 * check). Returns `undefined` on a database error, `[]` for an unknown/empty
 * thread. Never throws.
 */
export async function getConversationMessages(
  code: string,
  threadId: string,
): Promise<Message[] | undefined> {
  if (!THREAD_ID_PATTERN.test(threadId)) return [];
  try {
    const res = await getDb().execute<{ id: string; role: string; content: string }>(sql`
      SELECT m.id, m.role, m.content
      FROM mastra_messages m
      JOIN mastra_threads t ON t.id = m.thread_id
      WHERE m.thread_id = ${threadId} AND t.resourceId = ${code}
      ORDER BY m.createdAt ASC, m.seq_id ASC
    `);
    return res.recordset.map(toAguiMessage).filter((m): m is Message => m !== null);
  } catch (error) {
    console.error("tutor-stats-store: loading conversation messages failed", error);
    return undefined;
  }
}

/**
 * Deletes a tutor code AND all of its conversation data — the teacher-initiated
 * cleanup that replaced garbage collection. The conversations (Mastra threads
 * and their messages) are removed through Mastra's OWN storage API so we never
 * mutate its schema by hand; the app-owned rows go through Drizzle. Ordered so a
 * mid-way failure is safe to retry: conversation data first, the code row LAST
 * (while the row exists the code still appears in the teacher's list).
 *
 * Best-effort and idempotent: returns `true` if everything we attempted
 * succeeded, `false` if any step failed (the caller surfaces a retry hint).
 * Never throws.
 */
export async function deleteTutorCodeAndData(code: string): Promise<boolean> {
  let ok = true;

  // 1. Conversations: list the code's threads and delete each (deleteThread
  //    removes the thread's messages in the same transaction).
  try {
    const storage = mastra.getStorage();
    const memory = storage ? await storage.getStore("memory") : undefined;
    if (!memory) {
      console.error(
        "tutor-stats-store: no Mastra storage configured — cannot delete conversations",
      );
      ok = false;
    } else {
      const { threads } = await memory.listThreads({
        filter: { resourceId: code },
        perPage: false,
      });
      for (const thread of threads) {
        await memory.deleteThread({ threadId: thread.id });
      }
    }
  } catch (error) {
    console.error("tutor-stats-store: deleting conversations failed", error);
    ok = false;
  }

  // 2. App-owned rows. user_chats (attribution) and recent_codes (shortcuts)
  //    first, then the tutor-code row itself last.
  try {
    const db = getDb();
    await db.delete(userChats).where(eq(userChats.code, code));
    await db.delete(recentCodes).where(eq(recentCodes.code, code));
    await db.delete(tutorCodes).where(eq(tutorCodes.code, code));
  } catch (error) {
    console.error("tutor-stats-store: deleting app-owned rows failed", error);
    ok = false;
  }

  return ok;
}
