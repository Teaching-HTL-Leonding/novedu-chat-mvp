import { randomInt } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import sql from "mssql";
import { buildDataStoreCredential } from "../lib/azure-credential";

// Mints tutor codes by writing rows DIRECTLY into the same database the dev
// server reads (`novedu_tutor_codes`), so e2e specs can produce valid (or
// deliberately expired/not-yet-active) codes without driving the Share Tutor
// UI each time. Needs the live database — `az login` for the data-store tenant
// — so every spec that mints a code carries the @live tag. Stable sample
// tutors live on `main` of the public repo precisely so these URLs stay valid.
//
// Deliberately uses the plain `mssql` driver instead of the app's Drizzle
// store: Playwright's CJS test runner cannot load drizzle-orm's ESM modules.
// The INSERT below must match lib/db/schema.ts — keep them in sync.

export const RAW_TUTORS =
  "https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/tutors";
export const VALID_TUTOR_URL = `${RAW_TUTORS}/simple-tutor.yaml`;
export const BROKEN_TUTOR_URL = `${RAW_TUTORS}/broken-tutor.yaml`;

// Rows minted here are attributed to a recognizable fake teacher, so they are
// easy to tell apart (and clean up) in the table. Short windows expire fast
// and the server's hourly GC removes them.
const E2E_CREATOR = "e2e-test-suite";

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

let poolPromise: Promise<sql.ConnectionPool> | undefined;

// One pool per Playwright worker, configured exactly like the app's
// (parse the connection string, replace auth with the Entra token credential).
function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    loadEnvConfig(process.cwd());
    const connectionString = process.env.MSSQL_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("e2e: MSSQL_CONNECTION_STRING is not set — cannot mint tutor codes");
    }
    const config = sql.ConnectionPool.parseConnectionString(connectionString);
    config.authentication = {
      type: "token-credential",
      options: { credential: buildDataStoreCredential() },
    };
    poolPromise = new sql.ConnectionPool(config).connect();
  }
  return poolPromise;
}

/**
 * Inserts a tutor code with a window of [now+startOffset, now+endOffset]
 * seconds and returns the code. Loads `.env` exactly as Next does, so the
 * database and credentials can never drift from the dev server's.
 */
export async function mintTutorCode(
  options: { tutor?: string; startOffset?: number; endOffset?: number; note?: string } = {},
): Promise<string> {
  const pool = await getPool();

  const code = Array.from(
    { length: 10 },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join("");
  const now = Math.floor(Date.now() / 1000);

  await pool
    .request()
    .input("code", sql.VarChar(10), code)
    .input("createdBy", sql.NVarChar(64), E2E_CREATOR)
    .input("tutorUrl", sql.NVarChar(2048), options.tutor ?? VALID_TUTOR_URL)
    .input("validFrom", sql.DateTime2, new Date((now + (options.startOffset ?? -3600)) * 1000))
    .input("validUntil", sql.DateTime2, new Date((now + (options.endOffset ?? 3600)) * 1000))
    .input("note", sql.NVarChar(200), options.note ?? "e2e test code")
    .query(
      `INSERT INTO novedu_tutor_codes (code, created_by, tutor_url, valid_from, valid_until, note, origin, created_at)
       VALUES (@code, @createdBy, @tutorUrl, @validFrom, @validUntil, @note, 'e2e', SYSUTCDATETIME())`,
    );

  return code;
}

/** One stored Mastra message row (role + the raw JSON content envelope). */
export interface StoredMessageRow {
  role: string;
  content: string;
}

/**
 * Reads the Mastra messages persisted under a tutor code (every thread whose
 * `resourceId` is the code), oldest first. Used by the @live persistence spec to
 * assert what actually landed in storage after a chat. A freshly minted code has
 * exactly one thread (one page load), so this is that conversation's rows.
 */
export async function getStoredMessages(code: string): Promise<StoredMessageRow[]> {
  const pool = await getPool();
  const res = await pool
    .request()
    .input("code", sql.VarChar(10), code)
    .query<StoredMessageRow>(
      `SELECT m.role, CAST(m.content AS NVARCHAR(MAX)) AS content
       FROM mastra_messages m
       JOIN mastra_threads t ON t.id = m.thread_id
       WHERE t.resourceId = @code
       ORDER BY m.createdAt ASC, m.seq_id ASC`,
    );
  return res.recordset;
}
