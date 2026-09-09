// SQLSTATE inspection for the app-owned `novedu_*` tables. Postgres reports a
// failure as a five-character SQLSTATE, and drizzle wraps the driver error
// (`DrizzleQueryError`), so the code sits on a nested `cause` rather than the
// thrown error itself — hence the walk, shared by both helpers here.
//
// `isUniqueViolation` is used wherever a collision is a real branch, not a bug:
// code minting retries (lib/code-store.ts), file/image name collisions against
// the partial unique index (lib/file-store.ts, lib/image-store.ts), the
// coding-key mint loop (lib/coding-key-store.ts) and the user↔chat link
// (lib/user-chat-store.ts, where a duplicate simply means "already linked").
// Pure upserts use `onConflictDoUpdate`/`onConflictDoNothing` and never reach it.
//
// `classifyDbFailure` answers a different question: did the server DECIDE? An
// image insert that failed definitely lets the caller delete the object it just
// wrote; an uncertain outcome (the connection died, possibly after the commit)
// must leave that object alone for reconciliation (docs/images.md).

/** Depth cap so a self-referencing `cause` chain can never spin forever. */
const MAX_CAUSE_DEPTH = 10;

const UNIQUE_VIOLATION = "23505";

/** Postgres "connection exception" — the one class that proves nothing about the transaction. */
const CONNECTION_EXCEPTION = "08";

// The SQLSTATE classes Postgres actually emits. The list is what makes the walk
// safe around NON-SQL errors that also carry a five-character `code`: a socket
// `EPIPE` must never be read as a SQLSTATE, or a connection failure would be
// mistaken for a decided transaction. An unknown class is treated as "no
// SQLSTATE", which is the SAFE direction — it degrades to `uncertain`.
const SQLSTATE_CLASSES = new Set([
  "00",
  "01",
  "02",
  "03",
  "08",
  "09",
  "0A",
  "0B",
  "0F",
  "0L",
  "0P",
  "0Z",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "2B",
  "2D",
  "2F",
  "34",
  "38",
  "39",
  "3B",
  "3D",
  "3F",
  "40",
  "42",
  "44",
  "53",
  "54",
  "55",
  "57",
  "58",
  "72",
  "F0",
  "HV",
  "P0",
  "XX",
]);

/** The bounded `error.cause` chain, deepest wrapper first. */
function* causeChain(error: unknown): Generator<Record<string, unknown>> {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== "object" || current === null) return;
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  for (const level of causeChain(error)) {
    if (level.code === UNIQUE_VIOLATION) return true;
  }
  return false;
}

/**
 * The Postgres SQLSTATE of a failure, or `null` when the error carries none
 * (a socket error, a pool timeout, an application bug).
 */
export function sqlState(error: unknown): string | null {
  for (const level of causeChain(error)) {
    const code = level.code;
    if (
      typeof code === "string" &&
      code.length === 5 &&
      /^[0-9A-Z]{5}$/.test(code) &&
      SQLSTATE_CLASSES.has(code.slice(0, 2))
    ) {
      return code;
    }
  }
  return null;
}

/**
 * Did the server decide the statement's fate?
 *
 * `definite` — a SQLSTATE outside class `08` came back, so the server answered
 * and the transaction rolled back (integrity, syntax, resource, operator
 * intervention, …). Compensating for it is safe.
 *
 * `uncertain` — class `08` (connection exception) or no SQLSTATE at all: the
 * connection broke and the write may or may not have committed. Callers must
 * NOT compensate; they leave the side effect for reconciliation.
 */
export function classifyDbFailure(error: unknown): "definite" | "uncertain" {
  const state = sqlState(error);
  if (state === null) return "uncertain";
  return state.slice(0, 2) === CONNECTION_EXCEPTION ? "uncertain" : "definite";
}
