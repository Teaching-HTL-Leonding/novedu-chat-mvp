import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Grant } from "@/lib/achievements/evaluate";
import type { LocalDate } from "@/lib/achievements/time";
import { getDb } from "@/lib/db";
import { achievements } from "@/lib/db/schema";
import { reportStoreFailure } from "@/lib/store-failure";

// A user's earned achievements (`novedu_achievements`, docs/home.md). Every
// function is keyed by the session user id; rows are never deleted. Never
// throws: a failed read or write comes back `undefined`.
//
// SERVER-ONLY: uses the database. Never import from client components.

const STORE = "achievement-store";

const grantColumns = {
  id: achievements.achievementId,
  qualifiedOn: achievements.qualifiedOn,
  seenAt: achievements.seenAt,
};

/** The user's stored grants (the "grants" fact group). */
export async function listGrants(userId: string): Promise<Grant[] | undefined> {
  try {
    return await getDb()
      .select(grantColumns)
      .from(achievements)
      .where(eq(achievements.userId, userId));
  } catch (error) {
    reportStoreFailure(STORE, "list grants", error);
    return undefined;
  }
}

/**
 * Inserts new grants in one statement (`ON CONFLICT DO NOTHING`, so two tabs
 * can never double-grant) and returns the user's stored grants afterwards. When
 * a concurrent load inserted some of them first, the rows are re-read, so the
 * caller only ever renders what is durable.
 */
export async function insertGrants(
  userId: string,
  grants: readonly { id: string; qualifiedOn: LocalDate }[],
  existing: readonly Grant[],
): Promise<Grant[] | undefined> {
  if (grants.length === 0) return [...existing];
  try {
    const inserted = await getDb()
      .insert(achievements)
      .values(grants.map((g) => ({ userId, achievementId: g.id, qualifiedOn: g.qualifiedOn })))
      .onConflictDoNothing({ target: [achievements.userId, achievements.achievementId] })
      .returning(grantColumns);
    if (inserted.length === grants.length) return [...existing, ...inserted];
  } catch (error) {
    reportStoreFailure(STORE, "insert grants", error);
    return undefined;
  }
  return listGrants(userId);
}

/**
 * Marks the user's grants as seen. Touches only the session user's rows that are
 * still unseen; foreign or unknown ids match nothing. Returns false on failure.
 */
export async function markSeen(userId: string, ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    await getDb()
      .update(achievements)
      .set({ seenAt: new Date() })
      .where(
        and(
          eq(achievements.userId, userId),
          inArray(achievements.achievementId, [...ids]),
          isNull(achievements.seenAt),
        ),
      );
    return true;
  } catch (error) {
    reportStoreFailure(STORE, "mark seen", error);
    return false;
  }
}
