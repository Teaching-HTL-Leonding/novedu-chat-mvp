import { randomInt } from "node:crypto";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { type CodeModule, isCodeModule } from "@/lib/code-modules/types";
import { getDb } from "@/lib/db";
import { codes } from "@/lib/db/schema";
import { containsAny } from "@/lib/db/text-filter";

// Persistence for codes in the `novedu_codes` SQL table: every code a teacher
// creates stores its `module`, the activity YAML URL (`file_url`), the
// availability window, an optional note, and the creating teacher (`created_by`).
// The stored row IS the security boundary — an activity at `/<code>` only opens
// while a matching row exists and "now" is inside its window. `generateCode()`
// mints 10 random characters from a 36-char alphabet (36^10 ≈ 3.6e15), so
// guessing one is not practical; the column is sized for future teacher-defined
// memorable codes, which trade enumeration-resistance for memorability (mitigated
// by the Entra auth gate, the window, and the thread-isolation HMAC).
//
// SERVER-ONLY: uses node:crypto and the database. Never import from client
// components.

// The accepted code shape: lowercase letters/digits/hyphen, 1–32 chars. Broad on
// purpose — it bounds the malformed-reject fast path AND admits future memorable
// codes (e.g. `bio101`); generation still mints the narrower `[a-z0-9]{10}`.
export const CODE_PATTERN = /^[a-z0-9-]{1,32}$/;

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 10;

/** Crypto-secure random code (`randomInt` is uniform — no modulo bias). */
export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Longest accepted teacher note — matches the `note` column's nvarchar(200). */
export const MAX_NOTE_LENGTH = 200;

// Unix-seconds values are 10 digits today; 15 caps far beyond year 9999 while
// staying well inside Number.isSafeInteger territory.
const TIMESTAMP_PATTERN = /^\d{1,15}$/;

export type CodeRequestValidation =
  | {
      ok: true;
      payload: { fileUrl: string; validFrom: Date; validUntil: Date; note: string };
    }
  | { ok: false; message: string };

/**
 * Validates a teacher's raw "create code" form input (file URL string,
 * start/end as unix-second strings, free-text note). Pure so the server action
 * stays a thin, auth-handling shell around it.
 *
 * The file URL is NORMALIZED to `URL.href` before it is stored, so the same
 * activity always produces the same stored URL regardless of how the teacher
 * typed it (trailing spaces, un-encoded characters, …).
 */
export function validateCodeRequest(input: {
  file: unknown;
  start: unknown;
  end: unknown;
  note: unknown;
}): CodeRequestValidation {
  let url: URL;
  try {
    url = new URL(typeof input.file === "string" ? input.file.trim() : "");
  } catch {
    return { ok: false, message: "Provide a public http(s) URL to the activity YAML file." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "Provide a public http(s) URL to the activity YAML file." };
  }

  const start = typeof input.start === "string" ? input.start : "";
  const end = typeof input.end === "string" ? input.end : "";
  if (!TIMESTAMP_PATTERN.test(start) || !TIMESTAMP_PATTERN.test(end)) {
    return { ok: false, message: "Pick both a start and an end date and time." };
  }
  const validFrom = new Date(Number(start) * 1000);
  const validUntil = new Date(Number(end) * 1000);
  if (validUntil <= validFrom) {
    return { ok: false, message: "The end of the availability window must be after its start." };
  }

  const note = (typeof input.note === "string" ? input.note : "").trim();
  if (note.length > MAX_NOTE_LENGTH) {
    return { ok: false, message: `The note must be at most ${MAX_NOTE_LENGTH} characters.` };
  }

  return { ok: true, payload: { fileUrl: url.href, validFrom, validUntil, note } };
}

/** A code's stored data, as read back from `novedu_codes`. */
export interface CodeEntry {
  code: string;
  /** Which shareable-activity module this code dispatches to. */
  module: CodeModule;
  /** Session user id (Entra `oid`) of the creating teacher. */
  createdBy: string;
  /** Public URL of the activity-definition YAML (normalized via `URL.href`). */
  fileUrl: string;
  /** Window start, UTC. Inclusive. */
  validFrom: Date;
  /** Window end, UTC. Inclusive. */
  validUntil: Date;
  /** Teacher's note, shown in their code list. May be empty. */
  note: string;
  /**
   * Origin the code was created on, e.g. `http://localhost:3000`. FOR THE
   * OPERATOR'S EYES ONLY — it tells DEV from PROD rows. Lookups never read it:
   * a code created on localhost works in production (same database).
   */
  origin: string | null;
  /**
   * The activity YAML's `anonymous` flag, FROZEN at create time (default `true`).
   * `false` means the stats page may show per-student data. A later YAML edit
   * does not change it; the runtime attribution path reads `anonymous` LIVE
   * instead (lib/user-chat-store.ts).
   */
  anonymous: boolean;
  createdAt: Date;
}

// Row shape from the DB has `module` as a plain string column; narrow it to the
// CodeModule union on read. A row whose module is not a known module — a corrupt
// or forward-compat row (e.g. a module written to the DB before its registry entry
// exists) — is treated as ABSENT (`null` here), so the registry is never indexed
// with an unknown key downstream: the runtime route, the stats/list pages, and the
// `/<code>` dispatcher all rely on `module` being a real `CodeModule`. checkCode
// then reports `unknown-code`, getCode `null`, and listCodes drops the row.
function toEntry(row: typeof codes.$inferSelect): CodeEntry | null {
  if (!isCodeModule(row.module)) {
    console.error(`code-store: code ${row.code} has unknown module ${JSON.stringify(row.module)}`);
    return null;
  }
  return { ...row, module: row.module };
}

export type CreateCodeResult = { stored: true; code: string } | { stored: false };

// A duplicate primary key surfaces as mssql error 2627 (PK constraint) or 2601
// (unique index), wrapped by drizzle in a DrizzleQueryError whose `cause` is the
// driver error — the signal to retry with a fresh random code.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2627 || number === 2601) return true;
  }
  return false;
}

// With a 36^10 keyspace two consecutive collisions are practically impossible;
// the cap only guards against a systematic duplicate-key error turning into an
// infinite loop.
const MAX_CODE_ATTEMPTS = 10;

/**
 * Stores a freshly created code. Never throws: the database being unavailable
 * means `{ stored: false }`, which the create action surfaces as an error —
 * without a stored row there is nothing to hand out.
 */
export async function createCode(
  createdBy: string,
  data: {
    module: CodeModule;
    fileUrl: string;
    validFrom: Date;
    validUntil: Date;
    note: string;
    origin?: string;
    /** The activity YAML's `anonymous` flag, captured now and frozen on the row. */
    anonymous: boolean;
  },
): Promise<CreateCodeResult> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const candidate = generateCode();
    try {
      await getDb().insert(codes).values({
        code: candidate,
        module: data.module,
        createdBy,
        fileUrl: data.fileUrl,
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        note: data.note,
        origin: data.origin,
        anonymous: data.anonymous,
        createdAt: new Date(),
      });
      return { stored: true, code: candidate };
    } catch (error) {
      if (isDuplicateKeyError(error)) continue; // code taken — retry with a new one
      console.error("code-store: failed to store code", error);
      return { stored: false };
    }
  }
  console.error("code-store: could not find a free code, code not stored");
  return { stored: false };
}

export type CheckCodeResult =
  // The code exists and "now" is inside its window — the activity may open.
  | { ok: true; entry: CodeEntry }
  // No row with this code — never issued or mistyped.
  | { ok: false; reason: "unknown-code" }
  // The code exists but "now" is outside its window; the bounds are included so
  // the UI can say WHEN the code opens/closed, in local time.
  | { ok: false; reason: "not-started" | "expired"; validFrom: Date; validUntil: Date }
  // Database misconfigured/unreachable — retrying later may work.
  | { ok: false; reason: "lookup-failed" };

export type CodeRejection = Extract<CheckCodeResult, { ok: false }>["reason"];

/**
 * THE security check for a code, used by the student entry route
 * (`app/[code]/page.tsx`), the chat runtime route, and the quiz actions — all of
 * which re-check on EVERY request, so an open activity stops accepting input once
 * the window closes. Both window bounds are inclusive. `now` is injected for
 * testability. Malformed codes are rejected without a database round-trip. Never
 * throws.
 */
export async function checkCode(code: string, now: Date = new Date()): Promise<CheckCodeResult> {
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: "unknown-code" };

  let rows: (typeof codes.$inferSelect)[];
  try {
    rows = await getDb().select().from(codes).where(eq(codes.code, code));
  } catch (error) {
    console.error("code-store: code lookup failed", error);
    return { ok: false, reason: "lookup-failed" };
  }

  const row = rows[0];
  if (!row) return { ok: false, reason: "unknown-code" };
  const entry = toEntry(row);
  // An unrecognized module is as good as no code for a student.
  if (!entry) return { ok: false, reason: "unknown-code" };
  if (now < entry.validFrom) {
    return {
      ok: false,
      reason: "not-started",
      validFrom: entry.validFrom,
      validUntil: entry.validUntil,
    };
  }
  if (now > entry.validUntil) {
    return {
      ok: false,
      reason: "expired",
      validFrom: entry.validFrom,
      validUntil: entry.validUntil,
    };
  }
  return { ok: true, entry };
}

/**
 * Codes for the "Codes" page — ALL teachers' codes (a teacher may see/manage
 * every code; finer-grained RBAC is planned), newest first, including
 * not-yet-started and expired ones. Filtering happens IN THE DATABASE (see
 * `docs/filtered-lists.md`), never in memory: an optional `search` term is a
 * case-insensitive contains-match over note/code, `createdBy` narrows to one
 * teacher's codes (the "Only my codes" toggle), and `module` narrows to one
 * activity. Never throws — an unreachable database reads as `undefined`, which
 * the page notes.
 */
export async function listCodes(opts?: {
  search?: string;
  createdBy?: string;
  module?: CodeModule;
}): Promise<CodeEntry[] | undefined> {
  const conditions: SQL[] = [];
  const term = opts?.search?.trim();
  if (term) {
    const match = containsAny(term, [codes.note, codes.code]);
    if (match) conditions.push(match);
  }
  if (opts?.createdBy) conditions.push(eq(codes.createdBy, opts.createdBy));
  if (opts?.module) conditions.push(eq(codes.module, opts.module));
  try {
    const rows = await getDb()
      .select()
      .from(codes)
      .where(and(...conditions))
      .orderBy(desc(codes.createdAt));
    return rows.map(toEntry).filter((entry): entry is CodeEntry => entry !== null);
  } catch (error) {
    console.error("code-store: listing codes failed", error);
    return undefined;
  }
}

/**
 * Looks up a single code by value, WITHOUT an ownership check — the gate for the
 * stats / conversation-viewer / edit / delete paths now that any effective
 * teacher may manage any code (finer-grained RBAC is planned; the page-level
 * `requireTeacherPage()` / action-level `requireTeacherUserId()` gate still
 * applies). Returns the row, `null` if the code is malformed or does not exist,
 * or `undefined` on a database error. Never throws.
 */
export async function getCode(code: string): Promise<CodeEntry | null | undefined> {
  if (!CODE_PATTERN.test(code)) return null;
  try {
    const rows = await getDb().select().from(codes).where(eq(codes.code, code));
    const row = rows[0];
    return row ? toEntry(row) : null;
  } catch (error) {
    console.error("code-store: code lookup failed", error);
    return undefined;
  }
}

export type UpdateCodeResult = { ok: true } | { ok: false; reason: "not-found" | "error" };

/**
 * Updates the editable fields of a code: the availability window and the note.
 * The file URL is INTENTIONALLY not updatable here — and neither is the frozen
 * `anonymous` flag (which is tied to that URL): editing them would break the
 * documented "anonymous frozen at create time" invariant. `not-found` if no row
 * matches (deleted meanwhile). Never throws.
 */
export async function updateCode(
  code: string,
  data: { validFrom: Date; validUntil: Date; note: string },
): Promise<UpdateCodeResult> {
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: "not-found" };
  try {
    const updated = await getDb()
      .update(codes)
      .set({ validFrom: data.validFrom, validUntil: data.validUntil, note: data.note })
      .where(eq(codes.code, code));
    const ra = (updated as { rowsAffected?: unknown }).rowsAffected;
    const affected = Array.isArray(ra) ? Number(ra[0] ?? 0) : typeof ra === "number" ? ra : 1;
    if (affected < 1) return { ok: false, reason: "not-found" };
    return { ok: true };
  } catch (error) {
    console.error("code-store: updating code failed", error);
    return { ok: false, reason: "error" };
  }
}
