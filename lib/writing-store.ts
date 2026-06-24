import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { writingSubmissions } from "@/lib/db/schema";

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

/**
 * All saved texts for a code, newest first by save time — the teacher review's
 * read. Anonymous codes have no rows, so the review is empty for them. Never
 * throws: an unreachable database reads as an empty list.
 */
export async function listSubmissions(code: string): Promise<WritingSubmission[]> {
  try {
    return await getDb()
      .select()
      .from(writingSubmissions)
      .where(eq(writingSubmissions.code, code))
      .orderBy(desc(writingSubmissions.textUpdatedAt));
  } catch (error) {
    console.error("writing-store: listing submissions failed", error);
    return [];
  }
}
