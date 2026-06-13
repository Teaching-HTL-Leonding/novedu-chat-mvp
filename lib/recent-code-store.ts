import { and, desc, eq, notInArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { recentCodes, tutorCodes } from "@/lib/db/schema";

// A user's recently used tutor codes (`novedu_recent_codes`), backing the
// shortcuts on the chat entry page. Server-side bookkeeping around chat opens:
// a successful open records the code, an open that fails with a dead code
// removes it. All functions are best-effort and never throw — losing a
// shortcut must never break opening a chat.
//
// SERVER-ONLY: uses the database. Never import from client components.

/** How many recently used codes are kept per user (and shown). */
export const MAX_RECENT_CODES = 10;

/** A recent code joined with its (still existing) tutor-code row. */
export interface RecentCode {
  code: string;
  /** The teacher's note — the shortcut's label (fallback: the code itself). */
  note: string;
  lastUsed: Date;
}

// Mirrors isDuplicateKeyError in tutor-code-store: mssql 2627/2601 wrapped in a
// DrizzleQueryError's `cause` chain.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2627 || number === 2601) return true;
  }
  return false;
}

/**
 * The user's most recently used codes, newest first — joined with
 * `novedu_tutor_codes` for the note, so garbage-collected codes drop out of
 * the list by themselves (inner join). Includes currently expired or
 * not-yet-started codes as long as their row exists: clicking one shows the
 * window error, and definitively dead ones are removed there.
 */
export async function listRecentCodes(userId: string): Promise<RecentCode[]> {
  try {
    return await getDb()
      .select({ code: recentCodes.code, note: tutorCodes.note, lastUsed: recentCodes.lastUsed })
      .top(MAX_RECENT_CODES)
      .from(recentCodes)
      .innerJoin(tutorCodes, eq(recentCodes.code, tutorCodes.code))
      .where(eq(recentCodes.userId, userId))
      .orderBy(desc(recentCodes.lastUsed));
  } catch (error) {
    console.error("recent-code-store: listing recent codes failed", error);
    return [];
  }
}

/**
 * Records that the user opened a chat with this code: upsert (insert, fall
 * back to refreshing `last_used` on duplicate), then prune everything beyond
 * the newest MAX_RECENT_CODES rows for this user.
 */
export async function recordRecentCode(userId: string, code: string): Promise<void> {
  const db = getDb();
  try {
    try {
      await db.insert(recentCodes).values({ userId, code, lastUsed: new Date() });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      await db
        .update(recentCodes)
        .set({ lastUsed: new Date() })
        .where(and(eq(recentCodes.userId, userId), eq(recentCodes.code, code)));
    }

    // Prune: keep only the newest MAX_RECENT_CODES per user. TOP needs an
    // ORDER BY-stable subselect, so read the survivors and delete the rest.
    const keep = await db
      .select({ code: recentCodes.code })
      .top(MAX_RECENT_CODES)
      .from(recentCodes)
      .where(eq(recentCodes.userId, userId))
      .orderBy(desc(recentCodes.lastUsed));
    await db.delete(recentCodes).where(
      and(
        eq(recentCodes.userId, userId),
        notInArray(
          recentCodes.code,
          keep.map((row) => row.code),
        ),
      ),
    );
  } catch (error) {
    console.error("recent-code-store: recording a recent code failed", error);
  }
}

/**
 * Drops a code from the user's recents — called when opening it failed with a
 * definitively dead code (unknown or expired).
 */
export async function removeRecentCode(userId: string, code: string): Promise<void> {
  try {
    await getDb()
      .delete(recentCodes)
      .where(and(eq(recentCodes.userId, userId), eq(recentCodes.code, code)));
  } catch (error) {
    console.error("recent-code-store: removing a recent code failed", error);
  }
}
