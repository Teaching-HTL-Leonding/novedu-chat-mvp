import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { writingSubmissions } from "@/lib/db/schema";
import { containsAny } from "@/lib/db/text-filter";

// Persistence for writing submissions in the `novedu_writing_submissions` SQL
// table: one saved text per `(code, student)`, upserted on save (single version,
// no history). The access to that table for save, the render component's prefill,
// and the teacher review all go through here. The code-delete paths delete these
// rows inline in `deleteCodeRows` (lib/code-stats-store.ts) so the delete stays in
// the bulk transaction.
//
// SERVER-ONLY: uses the database. Never import from client components.

/** A student's saved writing text, as read back from `novedu_writing_submissions`. */
export interface WritingSubmission {
  code: string;
  /** The student's Entra `oid`. */
  userId: string;
  /** The saved Markdown. */
  text: string;
  /** Last save time, UTC. */
  textUpdatedAt: Date;
}

// Mirrors isDuplicateKeyError in code-store: mssql 2627/2601 wrapped in a
// DrizzleQueryError's `cause` chain — the signal a row already exists, so the
// upsert falls back to an UPDATE.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2627 || number === 2601) return true;
  }
  return false;
}

/**
 * The student's saved text for a code, or `null` if they have not saved one (or
 * on a database error). Used by the render component to prefill the editor.
 */
export async function getSubmission(
  code: string,
  userId: string,
): Promise<WritingSubmission | null> {
  try {
    const rows = await getDb()
      .select()
      .from(writingSubmissions)
      .where(and(eq(writingSubmissions.code, code), eq(writingSubmissions.userId, userId)));
    return rows[0] ?? null;
  } catch (error) {
    console.error("writing-store: reading a submission failed", error);
    return null;
  }
}

/**
 * Saves a student's text for a code: upsert (insert, fall back to UPDATE on a
 * duplicate primary key), stamping `textUpdatedAt = now`. The PK `(code, userId)`
 * means a student can only ever write their own single row.
 */
export async function saveSubmission(input: {
  code: string;
  userId: string;
  text: string;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  try {
    await db.insert(writingSubmissions).values({
      code: input.code,
      userId: input.userId,
      text: input.text,
      textUpdatedAt: now,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await db
      .update(writingSubmissions)
      .set({ text: input.text, textUpdatedAt: now })
      .where(
        and(eq(writingSubmissions.code, input.code), eq(writingSubmissions.userId, input.userId)),
      );
  }
}

/** A student who has saved text for a code — one row of the teacher's savers list. */
export interface Saver {
  /** The student's Entra `oid`. */
  userId: string;
  /** Last save time, UTC. */
  textUpdatedAt: Date;
  /** Qualifying conversations this student had for this code (≥ 1 user message). */
  conversationCount: number;
}

/**
 * Students who saved text for a code, newest save first, each with a count of
 * their qualifying conversations (threads with ≥ 1 user message). Backs the
 * teacher's savers list; the optional `search` filters by student id IN THE
 * DATABASE (docs/filtered-lists.md). NO text bodies are read — the list never
 * loads essay content. The conversation count is a correlated subquery joining the
 * Mastra tables BY VALUE (the sanctioned cross-table pattern; see code-stats-store)
 * in ONE round trip — no N+1. Anonymous codes have no rows, so the list is empty
 * for them. Never throws: an unreachable database reads as an empty list.
 */
export async function listSavers(code: string, opts?: { search?: string }): Promise<Saver[]> {
  try {
    return await getDb()
      .select({
        userId: writingSubmissions.userId,
        textUpdatedAt: writingSubmissions.textUpdatedAt,
        conversationCount: sql<number>`(
          SELECT COUNT(*) FROM mastra_threads t
          JOIN novedu_user_chats uc ON uc.thread_id = t.id
          WHERE t.resourceId = ${writingSubmissions.code}
            AND uc.user_id = ${writingSubmissions.userId}
            AND EXISTS (
              SELECT 1 FROM mastra_messages m
              WHERE m.thread_id = t.id AND m.role = 'user'
            )
        )`.mapWith(Number),
      })
      .from(writingSubmissions)
      .where(
        and(
          eq(writingSubmissions.code, code),
          containsAny(opts?.search ?? "", [writingSubmissions.userId]),
        ),
      )
      .orderBy(desc(writingSubmissions.textUpdatedAt));
  } catch (error) {
    console.error("writing-store: listing savers failed", error);
    return [];
  }
}
