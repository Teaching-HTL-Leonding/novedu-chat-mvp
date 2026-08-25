import { and, desc, eq, inArray } from "drizzle-orm";
import { generateCodingKey, KEY_PATTERN } from "@/lib/coding-key";
import { type DbExecutor, getDb } from "@/lib/db";
import { codingKeys, users } from "@/lib/db/schema";

// Persistence for the coding module's per-user API keys in the
// `novedu_coding_keys` SQL table: one STABLE key per `(code, user)`, handed back
// unchanged on every later read. This module is the ONLY access to that table —
// every issuance path (the student's first visit to a coding activity, the
// teacher's explicit "Get my API key" action, any future CLI command) must mint
// through `getOrCreateCodingKey` so all surfaces yield the identical key.
//
// TWO read shapes, deliberately separate: `getOrCreateCodingKey` MINTS when there
// is none (the student page, whose visit IS the request for a key), while
// `getStoredCodingKey` only READS (the teacher detail page, where merely looking
// at a code must never attribute a key row to the teacher — minting there is the
// button's server action).
//
// The stored key row IS the security boundary for the PUBLIC coding proxy, beside
// the code row: `lookupCodingKey` resolves a bearer token to its `(code, userId)`
// pair and the route re-runs `checkCode` on top, on EVERY request — so a closed
// window or a deleted code kills all of the code's keys at once (docs/coding.md).
// Issuance is always attributed to the requesting user (the second sanctioned
// user↔code link, behind an explicit on-page notice — see lib/db/schema.ts), while
// coding conversations themselves are never stored.
//
// Key VALUES are secrets: they are never logged, never put in an error message,
// and never emitted to telemetry — the log lines below carry the code/oid only.
// The key FORMAT itself (`KEY_PATTERN`, `generateCodingKey`) lives in the pure
// lib/coding-key.ts, which the e2e harness shares.
//
// SERVER-ONLY: uses the database. Never import from client components, and never
// from the CLI-bundled `lib/**` closure.

// Mirrors isDuplicateKeyError in lib/user-name-store.ts (and code-store /
// writing-store): mssql 2627/2601 wrapped in a DrizzleQueryError's `cause` chain.
// Here it is ambiguous by design — it means EITHER the `(code, user_id)` PK
// already has a key (a concurrent first visit won the race) OR the freshly minted
// `api_key` hit the unique index (a re-mint); `getOrCreateCodingKey` tells the two
// apart by looking for the existing row.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2627 || number === 2601) return true;
  }
  return false;
}

/** A user's stored key for one coding code, as read back from `novedu_coding_keys`. */
export interface CodingKeyRow {
  code: string;
  /** The requesting user's Entra `oid`. */
  userId: string;
  /** The bearer secret the coding tool authenticates with. */
  apiKey: string;
  /** Issuance time, UTC — the teacher's "requested at". */
  createdAt: Date;
}

/** The one `(code, userId)` row read, shared by both public read paths. Throws. */
function readStored(code: string, userId: string): Promise<CodingKeyRow[]> {
  return getDb()
    .select()
    .from(codingKeys)
    .where(and(eq(codingKeys.code, code), eq(codingKeys.userId, userId)));
}

export type StoredCodingKey =
  // The user already holds a key for this code.
  | { status: "found"; key: CodingKeyRow }
  // No row yet — nothing has been minted for this `(code, user)` pair.
  | { status: "none" }
  // Database misconfigured/unreachable — retrying later may work.
  | { status: "error" };

/**
 * READ-ONLY: the user's stored key for a coding code, or the fact that there is
 * none. NEVER inserts — this is what the teacher detail page calls, so viewing a
 * code cannot attribute a key row to the viewing teacher (`docs/coding.md`); the
 * "Get my API key" action mints through `getOrCreateCodingKey` instead.
 *
 * A database failure is its own `error` status (the shape `lookupCodingKey` uses)
 * rather than a `null` collapsed with "no key yet": the caller must be able to
 * show "temporarily unavailable" instead of offering a button that would mint a
 * second key once the database answers again. Never throws.
 */
export async function getStoredCodingKey(code: string, userId: string): Promise<StoredCodingKey> {
  try {
    const stored = await readStored(code, userId);
    return stored[0] ? { status: "found", key: stored[0] } : { status: "none" };
  } catch (error) {
    console.error(`coding-key-store: reading the key for code ${code} failed`, error);
    return { status: "error" };
  }
}

// With a 36^40 keyspace an api_key collision is practically impossible; the cap
// only guards against a systematic duplicate-key error turning into an infinite
// loop (same reasoning as MAX_CODE_ATTEMPTS in `createCode`).
const MAX_KEY_ATTEMPTS = 10;

/**
 * The user's key for a coding code, minting one on first use: SELECT of the
 * `(code, userId)` row first, INSERT of a freshly generated key only when there is
 * none. IDEMPOTENT — a revisit from any device always yields the same key, which is
 * what lets the page simply re-display it, and the revisit (the dominant path: one
 * per page view) costs exactly that one read.
 *
 * The INSERT is still racy, so a duplicate-key error is caught and resolved by
 * re-reading the row: with one present, a concurrent first visit won the race and
 * its key is handed back; with none, the minted `api_key` itself collided on the
 * unique index, so the loop re-mints. Returns `null` on a database failure (logged)
 * — the caller renders "connection details temporarily unavailable" rather than a
 * broken key. Never throws.
 */
export async function getOrCreateCodingKey(
  code: string,
  userId: string,
): Promise<CodingKeyRow | null> {
  try {
    const stored = await readStored(code, userId);
    if (stored[0]) return stored[0];
  } catch (error) {
    console.error(`coding-key-store: reading the key for code ${code} failed`, error);
    return null;
  }

  for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
    const row: CodingKeyRow = {
      code,
      userId,
      apiKey: generateCodingKey(),
      createdAt: new Date(),
    };
    try {
      await getDb().insert(codingKeys).values(row);
      return row;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        console.error(`coding-key-store: minting a key for code ${code} failed`, error);
        return null;
      }
      let existing: CodingKeyRow[];
      try {
        existing = await readStored(code, userId);
      } catch (selectError) {
        console.error(`coding-key-store: reading the key for code ${code} failed`, selectError);
        return null;
      }
      // A concurrent first visit stored a key meanwhile — hand back its row …
      if (existing[0]) return existing[0];
      // … otherwise the minted key value was taken: retry with a new one.
    }
  }
  console.error(`coding-key-store: could not find a free key for code ${code}, key not stored`);
  return null;
}

export type CodingKeyLookup =
  // The bearer is a stored key — the `(code, userId)` pair it was issued for.
  | { status: "found"; code: string; userId: string }
  // No row with this key — malformed, never issued, or its row is gone.
  | { status: "miss" }
  // Database misconfigured/unreachable — retrying later may work.
  | { status: "error" };

/**
 * THE resolution the public coding proxy runs on every request: a bearer token
 * back to the `(code, userId)` it was issued for. The caller then re-checks the
 * code itself (`checkCode`) — this only answers "whose key is this". Malformed
 * tokens are a `miss` without a database round-trip (mirroring `checkCode`'s
 * CODE_PATTERN fast path), so a flood of junk bearers never reaches SQL.
 *
 * A database failure is its own `error` status, mirroring `checkCode`'s
 * `lookup-failed`, so an outage gets the route's retryable 503 rather than the
 * permanent-sounding opaque 401 that only a real `miss` earns. Both stay opaque
 * about WHICH key was sent. Never throws — and never logs the key.
 */
export async function lookupCodingKey(apiKey: string): Promise<CodingKeyLookup> {
  if (!KEY_PATTERN.test(apiKey)) return { status: "miss" };
  try {
    const rows = await getDb()
      .select({ code: codingKeys.code, userId: codingKeys.userId })
      .from(codingKeys)
      .where(eq(codingKeys.apiKey, apiKey));
    const row = rows[0];
    return row ? { status: "found", code: row.code, userId: row.userId } : { status: "miss" };
  } catch (error) {
    console.error("coding-key-store: key lookup failed", error);
    return { status: "error" };
  }
}

/** One row of the teacher's issued-keys list for a coding code. */
export interface CodingKeyIssuance {
  /** The requesting user's Entra `oid`. */
  userId: string;
  /**
   * The user's display name (resolved from `novedu_users`), or `null` when no
   * name has been recorded yet — the caller falls back to the `oid` then.
   */
  displayName: string | null;
  /** Issuance time, UTC. */
  createdAt: Date;
}

/**
 * Who requested a key for a coding code, newest first — the teacher's read-only
 * issuance list. The display name is resolved by a LEFT JOIN on `novedu_users`
 * (BY VALUE, no FK — the sanctioned cross-table pattern, as in `listSavers`), so
 * a user with no recorded name comes back with `displayName: null`. The KEY
 * VALUES are deliberately not selected: a teacher sees WHO holds a key, never
 * another user's secret. Never throws: an unreachable database reads as an empty
 * list.
 */
export async function listCodingKeys(code: string): Promise<CodingKeyIssuance[]> {
  try {
    return await getDb()
      .select({
        userId: codingKeys.userId,
        displayName: users.displayName,
        createdAt: codingKeys.createdAt,
      })
      .from(codingKeys)
      .leftJoin(users, eq(users.userId, codingKeys.userId))
      .where(eq(codingKeys.code, code))
      .orderBy(desc(codingKeys.createdAt));
  } catch (error) {
    console.error("coding-key-store: listing keys failed", error);
    return [];
  }
}

/**
 * Drops every key issued for the given codes — the ONLY deletion path there is
 * (no revocation, no garbage collection). Called by the codes bulk delete
 * (`deleteCodesAndData`), which is why it takes a `DbExecutor`: the deletes join
 * that one transaction instead of running on their own handle. Throws on a DB
 * error, rolling the batch back with the rest.
 *
 * ACCEPTED RACE: a mint that started before this delete can commit after it,
 * leaving one attributed key row for a code that no longer exists. Harmless by
 * construction — the coding proxy re-runs `checkCode` on every request, so the
 * orphan authenticates nothing, and its `(code, user_id, created_at)` is no more
 * than the deleted code already disclosed. Nothing collects it: the row simply
 * stays until the same code string is re-minted and deleted again. Closing the
 * window instead is race-free (the row keeps pointing at a live, closed code).
 */
export async function deleteCodingKeysForCodes(
  executor: DbExecutor,
  codes: string[],
): Promise<void> {
  await executor.delete(codingKeys).where(inArray(codingKeys.code, codes));
}
