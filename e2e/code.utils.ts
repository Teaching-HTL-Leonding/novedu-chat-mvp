import { randomInt } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import sql from "mssql";
import { buildMssqlConnectionConfig } from "../lib/azure-credential";
import { FIXTURES_BASE } from "./fixtures.constants";

// Mints codes by writing rows DIRECTLY into the same database the dev server
// reads (`novedu_codes`), so e2e specs can produce valid (or deliberately
// expired/not-yet-active) codes for any module without driving the create UI each
// time. Needs the live database — `az login` for the data-store tenant — so every
// spec that mints a code carries the @live tag.
//
// Activity YAML is served by the local fixtures server (test-fixtures/serve.mjs,
// wired as a second Playwright webServer). The dev server fetches these URLs
// server-side, so 127.0.0.1 resolves — fully offline. The server's address is
// the shared constant in e2e/fixtures.constants.ts.
//
// Deliberately uses the plain `mssql` driver instead of the app's Drizzle store:
// Playwright's CJS test runner cannot load drizzle-orm's ESM modules. The INSERT
// below must match lib/db/schema.ts — keep them in sync.
export const VALID_TUTOR_URL = `${FIXTURES_BASE}/tutors/test-tutor.yaml`;
export const BROKEN_TUTOR_URL = `${FIXTURES_BASE}/tutors/broken-tutor.yaml`;
// A minimal tutor with a REAL model for the @live-llm chat specs (they send a
// message and only assert a non-empty reply — content is irrelevant).
export const LIVE_TUTOR_URL = `${FIXTURES_BASE}/tutors/live-tutor.yaml`;
// A REAL-model tutor with image input enabled for the @live-llm image round-trip.
export const VISION_TUTOR_URL = `${FIXTURES_BASE}/tutors/vision-tutor.yaml`;
// A valid CODING activity URL — coding has a strict authoring gate, so a coding
// code must point at a real coding YAML (a tutor URL would fail CODING_SCHEMA_ERROR).
export const VALID_CODING_URL = `${FIXTURES_BASE}/coding/test-coding.yaml`;
// A valid QUIZ activity URL, used by the teacher quiz-detail page.
export const VALID_QUIZ_URL = `${FIXTURES_BASE}/quizzes/test-quiz.yaml`;
// A valid WRITING activity URL (attributed, real model) for the full round-trip.
export const VALID_WRITING_URL = `${FIXTURES_BASE}/writings/test-writing.yaml`;

// Rows minted here are attributed to a recognizable fake teacher, so they are
// easy to tell apart (and clean up) in the table. There is no automatic GC, so a
// spec that mints a code cleans up after itself; in CI the whole SQL Server
// container is ephemeral and discarded with the runner, so nothing accumulates.
const E2E_CREATOR = "e2e-test-suite";

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

let poolPromise: Promise<sql.ConnectionPool> | undefined;

// One pool per Playwright worker, configured exactly like the app's (parse the
// connection string, pick SQL user/password or Entra auth from it).
function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    loadEnvConfig(process.cwd());
    const connectionString = process.env.MSSQL_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("e2e: MSSQL_CONNECTION_STRING is not set — cannot mint codes");
    }
    poolPromise = new sql.ConnectionPool(buildMssqlConnectionConfig(connectionString)).connect();
  }
  return poolPromise;
}

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
  } = {},
): Promise<string> {
  const pool = await getPool();

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

  await pool
    .request()
    .input("code", sql.VarChar(32), code)
    .input("module", sql.VarChar(16), options.module ?? "tutor")
    .input("createdBy", sql.NVarChar(64), E2E_CREATOR)
    .input("fileUrl", sql.NVarChar(2048), options.file ?? VALID_TUTOR_URL)
    .input("validFrom", sql.DateTime2, validFrom)
    .input("validUntil", sql.DateTime2, validUntil)
    .input("note", sql.NVarChar(200), options.note ?? "e2e test code")
    .input("anonymous", sql.Bit, options.anonymous === false ? 0 : 1)
    .query(
      `INSERT INTO novedu_codes (code, module, created_by, file_url, valid_from, valid_until, note, origin, anonymous, created_at)
       VALUES (@code, @module, @createdBy, @fileUrl, @validFrom, @validUntil, @note, 'e2e', @anonymous, SYSUTCDATETIME())`,
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
 * lib/user-name-store.ts' upsert as a single MERGE. Pair with `deleteUserName` so the
 * shared row never leaks to another spec.
 */
export async function setUserName(userId: string, displayName: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("userId", sql.NVarChar(64), userId)
    .input("displayName", sql.NVarChar(256), displayName)
    .query(
      `MERGE novedu_users AS t
       USING (SELECT @userId AS user_id) AS s ON t.user_id = s.user_id
       WHEN MATCHED THEN UPDATE SET display_name = @displayName
       WHEN NOT MATCHED THEN INSERT (user_id, display_name) VALUES (@userId, @displayName);`,
    );
}

/** Removes a `novedu_users` row — cleanup for `setUserName`. */
export async function deleteUserName(userId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("userId", sql.NVarChar(64), userId)
    .query(`DELETE FROM novedu_users WHERE user_id = @userId`);
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
  const pool = await getPool();
  const res = await pool
    .request()
    .input("code", sql.VarChar(32), code)
    .query<StoredMessageRow>(
      `SELECT m.role, CAST(m.content AS NVARCHAR(MAX)) AS content
       FROM mastra_messages m
       JOIN mastra_threads t ON t.id = m.thread_id
       WHERE t.resourceId = @code
       ORDER BY m.createdAt ASC, m.seq_id ASC`,
    );
  return res.recordset;
}
