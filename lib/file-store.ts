import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { files } from "@/lib/db/schema";

// Persistence for app-hosted YAML files in the `novedu_files` SQL table. The
// table is TEMPORAL/append-only: each row is one version of one file, the active
// version is the single row with `valid_until IS NULL`, every other row is
// history. See the schema comment in `lib/db/schema.ts` for the model; this
// module owns ALL access to the table so the "filter on the active version"
// invariant lives in one place.
//
// A file's stable identity is its `name` (the surrogate `id` is per-version), so
// every operation keys on the name. Functions never throw — a database problem
// surfaces as `undefined`/`{ ok: false }`, which callers turn into a graceful
// message.
//
// SERVER-ONLY: uses node:crypto and the database. Never import from client
// components.

/** Allowed file-name shape: letters, digits, underscore, hyphen — no spaces, max 100. */
export const FILE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export type FileKind = "tutor" | "fragment";

export function isFileKind(value: unknown): value is FileKind {
  return value === "tutor" || value === "fragment";
}

export type FileNameValidation = { ok: true; name: string } | { ok: false; message: string };

/**
 * Validates and normalizes a raw file-name input (trims surrounding whitespace,
 * then enforces {@link FILE_NAME_PATTERN}). Pure, so the GET route and the create
 * action share exactly one definition of a legal name.
 */
export function validateFileName(name: unknown): FileNameValidation {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!FILE_NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      message:
        "The name may contain only letters, digits, underscores and hyphens (max 100 characters) — no spaces.",
    };
  }
  return { ok: true, name: trimmed };
}

/** A file as shown in the teacher's list — the active version, WITHOUT its (large) content. */
export interface FileListEntry {
  id: string;
  name: string;
  kind: string;
  title: string | null;
  description: string | null;
  /** When the active version was written = the file's "last updated" time. */
  validFrom: Date;
  /** oid of the writer of the active version = the file's "last writer". */
  createdBy: string;
}

/** The active version of one file, including its content (for the editor / GET). */
export interface ActiveFile extends FileListEntry {
  content: string;
}

// The mssql driver returns an `IResult` whose `rowsAffected` is a per-statement
// array; read the first entry defensively so a conditional UPDATE can tell "I
// closed the active row" (>=1) from "there was nothing to close" (0).
function affectedRows(result: unknown): number {
  const ra = (result as { rowsAffected?: unknown }).rowsAffected;
  if (Array.isArray(ra)) return Number(ra[0] ?? 0);
  if (typeof ra === "number") return ra;
  return 0;
}

// Column caps for the DENORMALIZED search fields (see `title`/`description` in
// lib/db/schema.ts). They exist only so the list can be searched without parsing
// every body — the authoritative text always lives in `content` — so clamping an
// unusually long title/description to the column width is lossless for the file
// itself, and it stops a perfectly VALID tutor (whose schema imposes no length
// cap) from failing the INSERT with a truncation error.
const TITLE_MAX = 512;
const DESCRIPTION_MAX = 2048;
function clamp(value: string | null, max: number): string | null {
  return value !== null && value.length > max ? value.slice(0, max) : value;
}

// A unique-index violation surfaces as mssql error 2601 (unique index) or 2627
// (PK/unique constraint), wrapped by drizzle in a DrizzleQueryError whose `cause`
// is the driver error. For createFile that means the filtered unique index
// rejected a second active row for the same name — i.e. the name is taken.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2601 || number === 2627) return true;
  }
  return false;
}

/**
 * Every active (non-deleted) file, newest first — the "YAML Files" list. Content
 * is intentionally NOT selected (it can be large and the list never shows it).
 * `undefined` on a database error, which the page notes.
 */
export async function listFiles(): Promise<FileListEntry[] | undefined> {
  try {
    return await getDb()
      .select({
        id: files.id,
        name: files.name,
        kind: files.kind,
        title: files.title,
        description: files.description,
        validFrom: files.validFrom,
        createdBy: files.createdBy,
      })
      .from(files)
      .where(isNull(files.validUntil))
      .orderBy(desc(files.validFrom));
  } catch (error) {
    console.error("file-store: listing files failed", error);
    return undefined;
  }
}

/**
 * The active version of a file by name, WITH content — backs the edit page and
 * the public GET endpoint. `null` if the name is malformed or no active version
 * exists (unknown or soft-deleted); `undefined` on a database error.
 */
export async function getActiveFile(name: string): Promise<ActiveFile | null | undefined> {
  const valid = validateFileName(name);
  if (!valid.ok) return null;
  try {
    const rows = await getDb()
      .select()
      .from(files)
      .where(and(eq(files.name, valid.name), isNull(files.validUntil)));
    const entry = rows[0];
    if (!entry) return null;
    return {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      title: entry.title,
      description: entry.description,
      content: entry.content,
      validFrom: entry.validFrom,
      createdBy: entry.createdBy,
    };
  } catch (error) {
    console.error("file-store: active-file lookup failed", error);
    return undefined;
  }
}

export type CreateFileResult =
  | { ok: true; name: string }
  | { ok: false; reason: "name-taken" | "error" };

/**
 * Creates a brand-new file (version 1). Fails with `name-taken` if an active file
 * already uses the name (uniqueness is enforced here, among active files only, so
 * a name can be reused after its file is deleted). Runs in a transaction so the
 * existence check and the insert are atomic.
 */
export async function createFile(
  input: {
    name: string;
    kind: FileKind;
    content: string;
    title: string | null;
    description: string | null;
  },
  userId: string,
): Promise<CreateFileResult> {
  const now = new Date();
  try {
    return await getDb().transaction(async (tx) => {
      const existing = await tx
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.name, input.name), isNull(files.validUntil)));
      if (existing.length > 0) return { ok: false, reason: "name-taken" as const };

      await tx.insert(files).values({
        id: randomUUID(),
        name: input.name,
        kind: input.kind,
        title: clamp(input.title, TITLE_MAX),
        description: clamp(input.description, DESCRIPTION_MAX),
        content: input.content,
        createdBy: userId,
        validFrom: now,
        validUntil: null,
        closedBy: null,
      });
      return { ok: true, name: input.name };
    });
  } catch (error) {
    // The pre-check above handles the common case, but the filtered unique index
    // is the real guard against a concurrent create racing in after it.
    if (isDuplicateKeyError(error)) return { ok: false, reason: "name-taken" };
    console.error("file-store: create failed", error);
    return { ok: false, reason: "error" };
  }
}

export type UpdateFileResult = { ok: true } | { ok: false; reason: "not-found" | "error" };

/**
 * Saves a new version: closes the current active row (soft-delete it, recording
 * the writer in `closed_by`) and inserts a fresh active row carrying the new
 * content/title/description. The `kind` is preserved from the existing version.
 * The conditional close (`WHERE id=? AND valid_until IS NULL`) is the concurrency
 * guard — if a parallel writer already moved the file on, it affects 0 rows and
 * this returns `not-found` rather than minting a second active row.
 */
export async function updateFile(
  name: string,
  input: { content: string; title: string | null; description: string | null },
  userId: string,
): Promise<UpdateFileResult> {
  const now = new Date();
  try {
    return await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({ id: files.id, kind: files.kind })
        .from(files)
        .where(and(eq(files.name, name), isNull(files.validUntil)));
      const active = rows[0];
      if (!active) return { ok: false, reason: "not-found" as const };

      const closed = await tx
        .update(files)
        .set({ validUntil: now, closedBy: userId })
        .where(and(eq(files.id, active.id), isNull(files.validUntil)));
      if (affectedRows(closed) < 1) return { ok: false, reason: "not-found" as const };

      await tx.insert(files).values({
        id: randomUUID(),
        name,
        kind: active.kind,
        title: clamp(input.title, TITLE_MAX),
        description: clamp(input.description, DESCRIPTION_MAX),
        content: input.content,
        createdBy: userId,
        validFrom: now,
        validUntil: null,
        closedBy: null,
      });
      return { ok: true };
    });
  } catch (error) {
    console.error("file-store: update failed", error);
    return { ok: false, reason: "error" };
  }
}

export type DeleteFileResult = { ok: true } | { ok: false; reason: "not-found" | "error" };

/**
 * Soft-deletes a file: closes its active row (set `valid_until` + `closed_by`)
 * and inserts nothing, so no active version remains — the GET endpoint 404s and
 * the list drops it, while the full history (including who deleted it) stays.
 * A single conditional statement; `not-found` if it was already gone.
 */
export async function softDeleteFile(name: string, userId: string): Promise<DeleteFileResult> {
  const now = new Date();
  try {
    const closed = await getDb()
      .update(files)
      .set({ validUntil: now, closedBy: userId })
      .where(and(eq(files.name, name), isNull(files.validUntil)));
    if (affectedRows(closed) < 1) return { ok: false, reason: "not-found" };
    return { ok: true };
  } catch (error) {
    console.error("file-store: delete failed", error);
    return { ok: false, reason: "error" };
  }
}
