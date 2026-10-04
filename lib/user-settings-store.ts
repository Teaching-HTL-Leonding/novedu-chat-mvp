import { eq } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { reportStoreFailure } from "@/lib/store-failure";

// A user's preferences (`novedu_user_settings`, the Settings page — docs/home.md).
// The ONLY access to the table. A missing row means every default. Every
// function is keyed by the session user id the caller resolved. The standalone
// functions never throw (a failure comes back `undefined` / false); the
// `…InTransaction` helpers run inside another store's transaction and throw, so
// that transaction rolls back as a whole.
//
// SERVER-ONLY: uses the database. Never import from client components.

const STORE = "user-settings-store";

export interface UserSettings {
  /** The Finish page's "Always": save every quiz result without asking. */
  saveQuizResults: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = { saveQuizResults: false };

/** The user's settings, defaults filled in for a missing row. */
export async function getUserSettings(userId: string): Promise<UserSettings | undefined> {
  try {
    const rows = await getDb()
      .select({ saveQuizResults: userSettings.saveQuizResults })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return { ...DEFAULT_SETTINGS, ...rows[0] };
  } catch (error) {
    reportStoreFailure(STORE, "read settings", error);
    return undefined;
  }
}

/**
 * Upserts the given fields of the user's row. One statement: on an existing
 * row the upsert takes its row lock, so it serializes with an automatic quiz
 * save holding the row `FOR SHARE`. Returns false on failure.
 */
export async function updateUserSettings(
  userId: string,
  patch: Partial<UserSettings>,
): Promise<boolean> {
  if (Object.keys(patch).length === 0) return true;
  try {
    await getDb()
      .insert(userSettings)
      .values({ userId, ...DEFAULT_SETTINGS, ...patch })
      .onConflictDoUpdate({ target: userSettings.userId, set: patch });
    return true;
  } catch (error) {
    reportStoreFailure(STORE, "update settings", error);
    return false;
  }
}

/**
 * The quiz-save switch, read `FOR SHARE` inside the caller's transaction: a
 * concurrent switch-off waits for the save, and a save after the switch-off
 * reads false. Throws on a database error.
 */
export async function saveQuizResultsInTransaction(
  tx: DbExecutor,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ saveQuizResults: userSettings.saveQuizResults })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .for("share");
  return rows[0]?.saveQuizResults ?? DEFAULT_SETTINGS.saveQuizResults;
}

/** Turns the quiz-save switch on inside the caller's transaction. Throws on a database error. */
export async function enableQuizSavingInTransaction(tx: DbExecutor, userId: string): Promise<void> {
  await tx
    .insert(userSettings)
    .values({ userId, ...DEFAULT_SETTINGS, saveQuizResults: true })
    .onConflictDoUpdate({ target: userSettings.userId, set: { saveQuizResults: true } });
}

/**
 * Locks the user's row `FOR UPDATE` inside the caller's transaction, inserting
 * the defaults first when it is missing (a missing row has nothing to lock).
 * Serializes the caller with automatic saves. Throws on a database error.
 */
export async function lockSettingsInTransaction(tx: DbExecutor, userId: string): Promise<void> {
  await tx
    .insert(userSettings)
    .values({ userId, ...DEFAULT_SETTINGS })
    .onConflictDoNothing({ target: userSettings.userId });
  await tx
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .for("update");
}
