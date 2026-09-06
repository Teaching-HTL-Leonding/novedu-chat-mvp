import { and, desc, eq, notInArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { codes, recentCodes } from "@/lib/db/schema";

// A user's recently used codes (`novedu_recent_codes`), backing the shortcuts on
// the chat entry page. Server-side bookkeeping around opens: a successful open
// records the code, an open that fails with a dead code removes it. All functions
// are best-effort and never throw — losing a shortcut must never break opening an
// activity.
//
// SERVER-ONLY: uses the database. Never import from client components.

/** How many recently used codes are kept per user (and shown). */
export const MAX_RECENT_CODES = 10;

/** A recent code joined with its (still existing) code row. */
export interface RecentCode {
  code: string;
  /** The teacher's note — the shortcut's label (fallback: the code itself). */
  note: string;
  lastUsed: Date;
}

/**
 * The user's most recently used codes, newest first — joined with `novedu_codes`
 * for the note, so deleted codes drop out of the list by themselves (inner join).
 * Includes currently expired or not-yet-started codes as long as their row
 * exists: clicking one shows the window error, and definitively dead ones are
 * removed there.
 */
export async function listRecentCodes(userId: string): Promise<RecentCode[]> {
  try {
    return await getDb()
      .select({ code: recentCodes.code, note: codes.note, lastUsed: recentCodes.lastUsed })
      .from(recentCodes)
      .innerJoin(codes, eq(recentCodes.code, codes.code))
      .where(eq(recentCodes.userId, userId))
      .orderBy(desc(recentCodes.lastUsed))
      .limit(MAX_RECENT_CODES);
  } catch (error) {
    console.error("recent-code-store: listing recent codes failed", error);
    return [];
  }
}

/**
 * Records that the user opened a chat with this code: an `ON CONFLICT` upsert
 * (insert, or refresh `last_used` on the `(user_id, code)` conflict), then
 * prune everything beyond the newest MAX_RECENT_CODES rows for this user.
 */
export async function recordRecentCode(userId: string, code: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  try {
    await db
      .insert(recentCodes)
      .values({ userId, code, lastUsed: now })
      .onConflictDoUpdate({
        target: [recentCodes.userId, recentCodes.code],
        set: { lastUsed: now },
      });

    // Prune: keep only the newest MAX_RECENT_CODES per user, in ONE statement —
    // the survivors are a subquery (ORDER BY + LIMIT) inside the DELETE, so it
    // runs under a single snapshot and two concurrent opens cannot over-delete.
    await db
      .delete(recentCodes)
      .where(
        and(
          eq(recentCodes.userId, userId),
          notInArray(
            recentCodes.code,
            db
              .select({ code: recentCodes.code })
              .from(recentCodes)
              .where(eq(recentCodes.userId, userId))
              .orderBy(desc(recentCodes.lastUsed))
              .limit(MAX_RECENT_CODES),
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
