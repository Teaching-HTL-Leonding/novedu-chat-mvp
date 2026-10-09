import type { Message } from "@ag-ui/core";
import { sql } from "drizzle-orm";
import { collapseReplayedRuns, toAguiMessage } from "@/lib/conversation-collapse";
import { getDb } from "@/lib/db";

// The student-side reads behind a tutor's "resume on reload": when the thread's
// last message was written, and the thread's messages as AG-UI messages for the
// chat's `connect` snapshot (app/api/copilotkit/history-snapshot-runner.ts).
//
// Reads Mastra's tables by value with raw SQL (never declared to Drizzle — the
// pattern lib/code-stats-store.ts documents). Every read joins `mastra_threads`
// on `"resourceId" = code`, so a thread of another code yields nothing. Callers
// prove ownership first (the thread token over `(code, session user,
// threadId)`); this module never takes or returns a user id.
//
// Its importers are guard-tested (lib/tutor-history-isolation.unit.test.ts).
//
// SERVER-ONLY: uses the database. Never import from client components.

// Thread ids are server-generated UUIDs; this guards the value before it reaches
// a query, mirroring the pattern in user-chat-store / the runtime route.
const THREAD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * When the thread's latest message (user or assistant) was written, `null` for a
 * thread with no messages (or one of another code). Returns `undefined` on a
 * database error or a malformed thread id. Never throws.
 */
export async function threadLastMessageAt(
  code: string,
  threadId: string,
): Promise<Date | null | undefined> {
  if (!THREAD_ID_PATTERN.test(threadId)) return undefined;
  try {
    const res = await getDb().execute<{ lastAt: string | Date | null }>(sql`
      SELECT MAX(m."createdAtZ") AS "lastAt"
      FROM mastra.mastra_messages m
      JOIN mastra.mastra_threads t ON t.id = m.thread_id
      WHERE m.thread_id = ${threadId} AND t."resourceId" = ${code}
    `);
    const lastAt = res.rows[0]?.lastAt ?? null;
    return lastAt === null ? null : new Date(lastAt);
  } catch (error) {
    console.error("tutor-history-store: reading the thread's last message time failed", error);
    return undefined;
  }
}

/**
 * The thread's messages, oldest first, as AG-UI messages for the chat's
 * `connect` snapshot — ids unchanged (`mastra_messages.id`), which is what lets
 * the snapshot runner recognise the same messages in the in-process replay and
 * lets `@ag-ui/mastra` dedupe a re-sent user message. Replayed history is
 * collapsed so each turn shows once. `lastMessageAt` is `null` with no messages.
 * Returns `undefined` on a database error or a malformed thread id. Never throws.
 */
export async function loadThreadForChat(
  code: string,
  threadId: string,
): Promise<{ messages: Message[]; lastMessageAt: Date | null } | undefined> {
  if (!THREAD_ID_PATTERN.test(threadId)) return undefined;
  try {
    const res = await getDb().execute<{
      id: string;
      role: string;
      content: string;
      createdAt: string | Date;
    }>(sql`
      SELECT m.id, m.role, m.content, m."createdAtZ" AS "createdAt"
      FROM mastra.mastra_messages m
      JOIN mastra.mastra_threads t ON t.id = m.thread_id
      WHERE m.thread_id = ${threadId} AND t."resourceId" = ${code}
      ORDER BY m."createdAtZ" ASC, m.id ASC
    `);
    const last = res.rows.at(-1);
    const messages = res.rows.map(toAguiMessage).filter((m): m is Message => m !== null);
    return {
      messages: collapseReplayedRuns(messages),
      lastMessageAt: last ? new Date(last.createdAt) : null,
    };
  } catch (error) {
    console.error("tutor-history-store: loading the thread's messages failed", error);
    return undefined;
  }
}
