import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Persistence for the user-name lookup table (`novedu_users`): the Entra `oid`
// mapped to the display name shown in the nav bar (the Entra `name` claim). This
// module is the ONLY writer of that table; it is upserted once per interactive
// sign-in from the auth `jwt` callback (see auth.ts).
//
// There is no read helper here on purpose: resolution happens by LEFT JOIN inside
// the display queries that surface a student id (`listSavers` in lib/writing-store,
// `getCodeStats` in lib/code-stats-store) — the same by-value cross-table pattern
// the rest of the app uses — so a name is resolved in the SAME round trip as the
// rows it labels, with the raw oid as the fallback.
//
// SERVER-ONLY: uses the database. The auth callback imports this module
// DYNAMICALLY, so the SQL driver never loads on the proxy's per-request
// session-decode path.

// Same duplicate-key probe as the other stores: an mssql 2627/2601 surfaced through
// a DrizzleQueryError's `cause` chain means the row already exists, so the upsert
// falls back to an UPDATE.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2627 || number === 2601) return true;
  }
  return false;
}

/**
 * Records a user's current display name keyed by their Entra `oid`: INSERT, falling
 * back to UPDATE on a duplicate primary key (the user has signed in before). The
 * caller (the auth `jwt` callback) only invokes this with a non-empty name and
 * swallows any error — a database hiccup must never block sign-in (the name simply
 * isn't recorded, and the oid shows as the fallback) — so this may throw freely.
 */
export async function upsertUserName(input: {
  userId: string;
  displayName: string;
}): Promise<void> {
  const db = getDb();
  try {
    await db.insert(users).values({ userId: input.userId, displayName: input.displayName });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await db
      .update(users)
      .set({ displayName: input.displayName })
      .where(eq(users.userId, input.userId));
  }
}
