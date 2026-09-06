import { randomInt } from "node:crypto";
import { generateCodingKey } from "../lib/coding-key";
import { query } from "./db";
import { FIXTURES_BASE } from "./fixtures.constants";

// Mints codes by writing rows DIRECTLY into the same database the dev server
// reads (`novedu_codes`), so e2e specs can produce valid (or deliberately
// expired/not-yet-active) codes for any module without driving the create UI each
// time. Needs the live database — `az login` for the data-store tenant, or the CI
// container's dummy password — so every spec that mints a code carries the @live
// tag.
//
// Activity YAML is served by the local fixtures server (test-fixtures/serve.mjs,
// wired as a second Playwright webServer). The dev server fetches these URLs
// server-side, so 127.0.0.1 resolves — fully offline. The server's address is
// the shared constant in e2e/fixtures.constants.ts.
//
// Deliberately uses the plain `pg` driver (via `./db`) instead of the app's
// Drizzle store: Playwright's CJS test runner cannot load drizzle-orm's ESM
// modules. Every statement below must match lib/db/schema.ts — keep them in sync.
export const VALID_TUTOR_URL = `${FIXTURES_BASE}/tutors/test-tutor.yaml`;
export const BROKEN_TUTOR_URL = `${FIXTURES_BASE}/tutors/broken-tutor.yaml`;
// A minimal tutor with a REAL model for the @live-llm chat specs (they send a
// message and only assert a non-empty reply — content is irrelevant).
export const LIVE_TUTOR_URL = `${FIXTURES_BASE}/tutors/live-tutor.yaml`;
// A REAL-model tutor with image input enabled for the @live-llm image round-trip.
export const VISION_TUTOR_URL = `${FIXTURES_BASE}/tutors/vision-tutor.yaml`;
// A REAL-model tutor with the random_number tool for the @live-llm tool-call spec.
export const LIVE_TOOLS_TUTOR_URL = `${FIXTURES_BASE}/tutors/live-tools-tutor.yaml`;
// A valid CODING activity URL — coding has a strict authoring gate, so a coding
// code must point at a real coding YAML (a tutor URL would fail CODING_SCHEMA_ERROR).
export const VALID_CODING_URL = `${FIXTURES_BASE}/coding/test-coding.yaml`;
// A REAL-model coding activity for the @live-llm pi-agent spec (coding-agent.spec.ts).
export const LIVE_CODING_URL = `${FIXTURES_BASE}/coding/live-coding.yaml`;
// A valid QUIZ activity URL, used by the teacher quiz-detail page.
export const VALID_QUIZ_URL = `${FIXTURES_BASE}/quizzes/test-quiz.yaml`;
// A REAL-model quiz with photo answers enabled for the @live-llm image round-trip.
export const VISION_QUIZ_URL = `${FIXTURES_BASE}/quizzes/vision-quiz.yaml`;
// A valid WRITING activity URL (attributed, real model) for the full round-trip.
export const VALID_WRITING_URL = `${FIXTURES_BASE}/writings/test-writing.yaml`;

// Rows minted here are attributed to a recognizable fake teacher, so they are
// easy to tell apart (and clean up) in the table. There is no automatic GC, so a
// spec that mints a code cleans up after itself; in CI the whole Postgres
// container is ephemeral and discarded with the runner, so nothing accumulates.
const E2E_CREATOR = "e2e-test-suite";

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Inserts a code (any module) with a window of [now+startOffset, now+endOffset]
 * seconds and returns the code. Pass `startOffset: null` / `endOffset: null` to
 * leave that bound OPEN (a NULL column → an open-ended code). `module` defaults to
 * "tutor" and `file` to the synthetic fixture tutor (VALID_TUTOR_URL — its model is
 * the fake `test-model`, so a spec that actually SENDS a chat message must pass
 * LIVE_TUTOR_URL instead); pass `module: "quiz"` + an
 * app-hosted quiz `file` URL for the quiz flow. `anonymous` is the FROZEN row flag
 * and defaults to `true`
 * (matching tutor/quiz); pass `anonymous: false` for a writing code so its teacher
 * review shows the savers list (the writing detail dispatches on this flag). Loads
 * `.env` exactly as Next does, so the database and credentials can never drift from
 * the dev server's.
 */
export async function mintCode(
  options: {
    module?: string;
    file?: string;
    startOffset?: number | null;
    endOffset?: number | null;
    note?: string;
    anonymous?: boolean;
    /**
     * Per-code LLM override pair (both-or-nothing) — omitted = NULL columns.
     * `reasoning` is the pair's optional third field (the `reasoning_effort`
     * level); omitted leaves the model's own default in place.
     */
    llm?: { provider: string; model: string; reasoning?: string };
  } = {},
): Promise<string> {
  const code = Array.from(
    { length: 10 },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join("");
  const now = Math.floor(Date.now() / 1000);
  // `null` offset → an open (NULL) bound; otherwise now + offset (default ∓1h).
  const validFrom =
    options.startOffset === null ? null : new Date((now + (options.startOffset ?? -3600)) * 1000);
  const validUntil =
    options.endOffset === null ? null : new Date((now + (options.endOffset ?? 3600)) * 1000);

  await query(
    `INSERT INTO novedu_codes (code, module, created_by, file_url, valid_from, valid_until, note, origin, anonymous, llm_provider, llm_model, llm_reasoning, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'e2e', $8, $9, $10, $11, now())`,
    [
      code,
      options.module ?? "tutor",
      E2E_CREATOR,
      options.file ?? VALID_TUTOR_URL,
      validFrom,
      validUntil,
      options.note ?? "e2e test code",
      options.anonymous !== false,
      options.llm?.provider ?? null,
      options.llm?.model ?? null,
      options.llm?.reasoning ?? null,
    ],
  );

  return code;
}

/**
 * Convenience wrapper for the common tutor case. Like `mintCode`, a `null`
 * `startOffset` / `endOffset` leaves that bound OPEN (a NULL column → an
 * open-ended tutor code).
 */
export function mintTutorCode(
  options: {
    tutor?: string;
    startOffset?: number | null;
    endOffset?: number | null;
    note?: string;
  } = {},
): Promise<string> {
  return mintCode({
    module: "tutor",
    file: options.tutor,
    startOffset: options.startOffset,
    endOffset: options.endOffset,
    note: options.note,
  });
}

/**
 * Upserts a display name into `novedu_users` for a user id (the Entra `oid`, or the
 * `sub` fallback the e2e sessions use — the minted teacher token carries no `oid`,
 * so its id is `"e2e-teacher"`). Lets a @live-db review spec assert the savers list /
 * student page resolve an opaque id to a NAME, not just the oid fallback. Mirrors
 * lib/user-name-store.ts' upsert as a single INSERT … ON CONFLICT. Pair with
 * `deleteUserName` so the shared row never leaks to another spec.
 */
export async function setUserName(userId: string, displayName: string): Promise<void> {
  await query(
    `INSERT INTO novedu_users (user_id, display_name) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name`,
    [userId, displayName],
  );
}

/** Removes a `novedu_users` row — cleanup for `setUserName`. */
export async function deleteUserName(userId: string): Promise<void> {
  await query(`DELETE FROM novedu_users WHERE user_id = $1`, [userId]);
}

/** Removes a `novedu_codes` row — cleanup for codes a spec created via the API. */
export async function deleteCode(code: string): Promise<void> {
  await query(`DELETE FROM novedu_codes WHERE code = $1`, [code]);
}

/**
 * Deletes every `novedu_reports` row for a code — cleanup for the reports spec.
 * The `deleteCode` util drops only the `novedu_codes` row (the app's own
 * `deleteCodeRows` cascades to reports inside its transaction, but a raw
 * `DELETE FROM novedu_codes` does not), so a spec that mints reports tidies them
 * here so a mid-test failure leaves no strays in the shared dev database.
 */
export async function deleteReportsByCode(code: string): Promise<void> {
  await query(`DELETE FROM novedu_reports WHERE code = $1`, [code]);
}

// A dedicated fake requester id for minted coding keys, distinct from
// E2E_CREATOR (which attributes the CODE to a fake teacher) — the key row's
// `user_id` is a STUDENT/requester identity, so a separate recognizable
// constant keeps both roles easy to tell apart in the table.
const E2E_CODING_KEY_USER = "e2e-pi-agent";

/**
 * Mints a per-user coding API key by inserting directly into
 * `novedu_coding_keys`, the same direct-INSERT approach as `mintCode` — so the
 * @live-llm pi-agent spec can authenticate without driving the `/{code}`
 * sign-in UI. The key value comes from the app's own `generateCodingKey`
 * (lib/coding-key.ts — pure, so it loads here unlike the Drizzle store), so a
 * minted key is byte-shaped exactly like `getOrCreateCodingKey`'s. The INSERT
 * below must match lib/db/schema.ts's `codingKeys` table — keep them in sync.
 */
export async function mintCodingKey(options: { code: string; userId?: string }): Promise<string> {
  const apiKey = generateCodingKey();

  await query(
    `INSERT INTO novedu_coding_keys (code, user_id, api_key, created_at)
     VALUES ($1, $2, $3, now())`,
    [options.code, options.userId ?? E2E_CODING_KEY_USER, apiKey],
  );

  return apiKey;
}

/**
 * Deletes every `novedu_coding_keys` row for a code — cleanup for keys minted
 * via `mintCodingKey`, mirroring `deleteReportsByCode`: `deleteCode` drops only
 * the `novedu_codes` row, so a raw code delete does NOT cascade to key rows the
 * way the app's own bulk-delete transaction does
 * (`deleteCodingKeysForCodes`/`deleteCodesAndData`).
 */
export async function deleteCodingKeysByCode(code: string): Promise<void> {
  await query(`DELETE FROM novedu_coding_keys WHERE code = $1`, [code]);
}

/**
 * Hard-deletes ALL versions of an app-hosted file — cleanup for files a spec
 * created via the API. Test-only: the app itself never hard-deletes (the table
 * is append-only history); a leftover e2e row is the only reason to.
 */
export async function hardDeleteFile(name: string): Promise<void> {
  await query(`DELETE FROM novedu_files WHERE name = $1`, [name]);
}

/** One stored Mastra message row (role + the raw JSON content envelope). */
export interface StoredMessageRow {
  role: string;
  content: string;
}

/**
 * Reads the Mastra messages persisted under a code (every thread whose
 * `resourceId` is the code), oldest first. Used by the @live persistence spec to
 * assert what actually landed in storage after a chat. A freshly minted code has
 * exactly one thread (one page load), so this is that conversation's rows.
 */
export async function getStoredMessages(code: string): Promise<StoredMessageRow[]> {
  return query<StoredMessageRow>(
    `SELECT m.role, m.content
     FROM mastra.mastra_messages m
     JOIN mastra.mastra_threads t ON t.id = m.thread_id
     WHERE t."resourceId" = $1
     ORDER BY COALESCE(m."createdAtZ", m."createdAt" AT TIME ZONE 'UTC') ASC, m.id ASC`,
    [code],
  );
}
