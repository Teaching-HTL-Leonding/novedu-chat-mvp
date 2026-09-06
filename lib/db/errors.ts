// The ONE duplicate-key check for the app-owned `novedu_*` tables. Postgres
// reports a unique-constraint violation as SQLSTATE `23505`, and drizzle wraps
// the driver error (`DrizzleQueryError`), so the code sits on a nested `cause`
// rather than the thrown error itself — hence the walk.
//
// Used wherever a collision is a real branch, not a bug: code minting retries
// (lib/code-store.ts), file/image name collisions against the partial unique
// index (lib/file-store.ts, lib/image-store.ts), the coding-key mint loop
// (lib/coding-key-store.ts) and the user↔chat link (lib/user-chat-store.ts,
// where a duplicate simply means "already linked"). Pure upserts use
// `onConflictDoUpdate`/`onConflictDoNothing` and never reach this helper.

/** Depth cap so a self-referencing `cause` chain can never spin forever. */
const MAX_CAUSE_DEPTH = 10;

const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== "object" || current === null) return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
