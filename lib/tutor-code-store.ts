import { randomInt } from "node:crypto";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tutorCodes } from "@/lib/db/schema";

// Persistence for Tutor Codes in the `novedu_tutor_codes` SQL table: every code
// a teacher creates stores the tutor YAML URL, the availability window, an
// optional note, and the creating teacher (`created_by`). The stored row IS the
// security boundary — a chat at `/<code>` only opens while a matching row exists
// and "now" is inside its window. Codes are 10 random characters from a 36-char
// alphabet (36^10 ≈ 3.6e15), so guessing one is not practical.
//
// SERVER-ONLY: uses node:crypto and the database. Never import from client
// components.

/** Format of tutor codes: 10 random lowercase letters/digits. */
export const TUTOR_CODE_PATTERN = /^[a-z0-9]{10}$/;

const TUTOR_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const TUTOR_CODE_LENGTH = 10;

/** Crypto-secure random tutor code (`randomInt` is uniform — no modulo bias). */
export function generateTutorCode(): string {
  let code = "";
  for (let i = 0; i < TUTOR_CODE_LENGTH; i++) {
    code += TUTOR_CODE_ALPHABET[randomInt(TUTOR_CODE_ALPHABET.length)];
  }
  return code;
}

/** Longest accepted teacher note — matches the `note` column's nvarchar(200). */
export const MAX_NOTE_LENGTH = 200;

// Unix-seconds values are 10 digits today; 15 caps far beyond year 9999 while
// staying well inside Number.isSafeInteger territory.
const TIMESTAMP_PATTERN = /^\d{1,15}$/;

export type TutorCodeRequestValidation =
  | {
      ok: true;
      payload: { tutorUrl: string; validFrom: Date; validUntil: Date; note: string };
    }
  | { ok: false; message: string };

/**
 * Validates a teacher's raw "create tutor code" form input (tutor URL string,
 * start/end as unix-second strings, free-text note). Pure so the server action
 * stays a thin, auth-handling shell around it.
 *
 * The tutor URL is NORMALIZED to `URL.href` before it is stored, so the same
 * tutor always produces the same stored URL regardless of how the teacher
 * typed it (trailing spaces, un-encoded characters, …).
 */
export function validateTutorCodeRequest(input: {
  tutor: unknown;
  start: unknown;
  end: unknown;
  note: unknown;
}): TutorCodeRequestValidation {
  let url: URL;
  try {
    url = new URL(typeof input.tutor === "string" ? input.tutor.trim() : "");
  } catch {
    return { ok: false, message: "Provide a public http(s) URL to a tutor YAML file." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "Provide a public http(s) URL to a tutor YAML file." };
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

  return { ok: true, payload: { tutorUrl: url.href, validFrom, validUntil, note } };
}

/** A tutor code's stored data, as read back from `novedu_tutor_codes`. */
export interface TutorCodeEntry {
  code: string;
  /** Entra `sub` of the creating teacher. */
  createdBy: string;
  /** Public URL of the tutor-definition YAML (normalized via `URL.href`). */
  tutorUrl: string;
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
  createdAt: Date;
}

export type CreateTutorCodeResult = { stored: true; code: string } | { stored: false };

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
 * Stores a freshly created tutor code. Never throws: the database being
 * unavailable means `{ stored: false }`, which the create action surfaces as an
 * error — without a stored row there is nothing to hand out.
 */
export async function createTutorCode(
  createdBy: string,
  data: {
    tutorUrl: string;
    validFrom: Date;
    validUntil: Date;
    note: string;
    origin?: string;
  },
): Promise<CreateTutorCodeResult> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const candidate = generateTutorCode();
    try {
      await getDb().insert(tutorCodes).values({
        code: candidate,
        createdBy,
        tutorUrl: data.tutorUrl,
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        note: data.note,
        origin: data.origin,
        createdAt: new Date(),
      });
      return { stored: true, code: candidate };
    } catch (error) {
      if (isDuplicateKeyError(error)) continue; // code taken — retry with a new one
      console.error("tutor-code-store: failed to store tutor code", error);
      return { stored: false };
    }
  }
  console.error("tutor-code-store: could not find a free code, tutor code not stored");
  return { stored: false };
}

export type CheckTutorCodeResult =
  // The code exists and "now" is inside its window — the chat may open.
  | { ok: true; entry: TutorCodeEntry }
  // No row with this code — never issued, mistyped, or already garbage-collected.
  | { ok: false; reason: "unknown-code" }
  // The code exists but "now" is outside its window; the bounds are included so
  // the UI can say WHEN the code opens/closed, in local time.
  | { ok: false; reason: "not-started" | "expired"; validFrom: Date; validUntil: Date }
  // Database misconfigured/unreachable — retrying later may work.
  | { ok: false; reason: "lookup-failed" };

export type TutorCodeRejection = Extract<CheckTutorCodeResult, { ok: false }>["reason"];

/**
 * THE security check for a tutor code, used by both the chat page
 * (`app/[code]/page.tsx`) and the chat runtime route — the latter re-checks on
 * EVERY request, so an open chat stops accepting messages once the window
 * closes. Both window bounds are inclusive. `now` is injected for testability.
 * Malformed codes are rejected without a database round-trip. Never throws.
 */
export async function checkTutorCode(
  code: string,
  now: Date = new Date(),
): Promise<CheckTutorCodeResult> {
  if (!TUTOR_CODE_PATTERN.test(code)) return { ok: false, reason: "unknown-code" };

  let rows: TutorCodeEntry[];
  try {
    rows = await getDb().select().from(tutorCodes).where(eq(tutorCodes.code, code));
  } catch (error) {
    console.error("tutor-code-store: tutor-code lookup failed", error);
    return { ok: false, reason: "lookup-failed" };
  }

  const entry = rows[0];
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
 * All of a teacher's still-valid tutor codes (not yet expired — codes whose
 * window has not STARTED yet count as valid too), newest first. Backs the
 * "Shared Tutor Codes" page. Never throws — an unreachable database reads as an
 * empty list, which the page notes.
 */
export async function listValidTutorCodes(
  createdBy: string,
  now: Date = new Date(),
): Promise<TutorCodeEntry[] | undefined> {
  try {
    return await getDb()
      .select()
      .from(tutorCodes)
      .where(and(eq(tutorCodes.createdBy, createdBy), gte(tutorCodes.validUntil, now)))
      .orderBy(desc(tutorCodes.createdAt));
  } catch (error) {
    console.error("tutor-code-store: listing tutor codes failed", error);
    return undefined;
  }
}

/**
 * Garbage-collects expired tutor codes across ALL teachers (window over:
 * `valid_until < now` — at `valid_until === now` a code is still valid, see
 * checkTutorCode's inclusive bounds). Runs hourly from instrumentation.ts.
 * Deliberately does NOT touch `novedu_user_chats`: the user↔chat mapping
 * outlives the code so chat-history attribution keeps working. Never throws —
 * failures only log, and the next run picks up whatever was left behind.
 */
export async function gcExpiredTutorCodes(now: Date = new Date()): Promise<void> {
  try {
    await getDb().delete(tutorCodes).where(lt(tutorCodes.validUntil, now));
  } catch (error) {
    console.error("tutor-code-store: garbage collection of expired tutor codes failed", error);
  }
}
