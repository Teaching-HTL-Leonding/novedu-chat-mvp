import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { containsAny } from "@/lib/db/text-filter";
import { validateFileName } from "@/lib/file-name";
import { deleteBlob } from "@/lib/image-blob";

// Persistence for app-hosted image metadata in the `novedu_images` SQL table. The
// bytes live in Azure Blob Storage (one blob per row, addressed by `blob_path`);
// this table only tracks metadata. The table is TEMPORAL/append-only: each row is
// one version of one image, the active version is the single row with
// `valid_until IS NULL`, every other row is history. See the schema comment in
// `lib/db/schema.ts` for the model; this module owns ALL access to the table so
// the "filter on the active version" invariant lives in one place.
//
// An image's stable identity is its `name` (the surrogate `id` is per-version), so
// every operation keys on the name. Functions never throw — a database problem
// surfaces as `undefined`/`{ ok: false }`, which callers turn into a graceful
// message.
//
// SERVER-ONLY: uses node:crypto and the database. Never import from client
// components.

/** An image as shown in the teacher's list — the active version's metadata. */
export interface ImageListEntry {
  id: string;
  name: string;
  blobPath: string;
  mimeType: string;
  byteSize: number;
  /** Optional attribution / "Content Credentials" (e.g. CC BY) to show below the image. */
  credit: string | null;
  /** When the active version was written = the image's "last updated" time. */
  validFrom: Date;
  /** oid of the writer of the active version. */
  createdBy: string;
}

/** The active version of one image. Metadata only — the bytes live in Blob Storage. */
export type ActiveImage = ImageListEntry;

// The mssql driver returns an `IResult` whose `rowsAffected` is a per-statement
// array; read the first entry defensively so a conditional UPDATE can tell "I
// closed the active row" (>=1) from "there was nothing to close" (0).
function affectedRows(result: unknown): number {
  const ra = (result as { rowsAffected?: unknown }).rowsAffected;
  if (Array.isArray(ra)) return Number(ra[0] ?? 0);
  if (typeof ra === "number") return ra;
  return 0;
}

// A unique-index violation surfaces as mssql error 2601 (unique index) or 2627
// (PK/unique constraint), wrapped by drizzle in a DrizzleQueryError whose `cause`
// is the driver error. For confirmImage that means the filtered unique index
// rejected a second active row for the same name — i.e. the name is taken.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2601 || number === 2627) return true;
  }
  return false;
}

/**
 * The active (non-deleted) images for the "Images" list, newest first. Filtering
 * happens IN THE DATABASE (see `docs/filtered-lists.md`), never in memory: an
 * optional `search` term is a case-insensitive contains-match over the name, and
 * `createdBy` narrows to one writer's images (the "Only my images" toggle).
 * `undefined` on a database error, which the page notes.
 */
export async function listImages(opts?: {
  search?: string;
  createdBy?: string;
}): Promise<ImageListEntry[] | undefined> {
  const conditions: SQL[] = [isNull(images.validUntil)];
  const term = opts?.search?.trim();
  if (term) {
    const match = containsAny(term, [images.name]);
    if (match) conditions.push(match);
  }
  if (opts?.createdBy) conditions.push(eq(images.createdBy, opts.createdBy));
  try {
    return await getDb()
      .select({
        id: images.id,
        name: images.name,
        blobPath: images.blobPath,
        mimeType: images.mimeType,
        byteSize: images.byteSize,
        credit: images.credit,
        validFrom: images.validFrom,
        createdBy: images.createdBy,
      })
      .from(images)
      .where(and(...conditions))
      .orderBy(desc(images.validFrom));
  } catch (error) {
    console.error("image-store: listing images failed", error);
    return undefined;
  }
}

/**
 * The active version of an image by name. `null` if the name is malformed or no
 * active version exists (unknown or soft-deleted); `undefined` on a database
 * error.
 */
export async function getActiveImage(name: string): Promise<ActiveImage | null | undefined> {
  const valid = validateFileName(name);
  if (!valid.ok) return null;
  try {
    const rows = await getDb()
      .select()
      .from(images)
      .where(and(eq(images.name, valid.name), isNull(images.validUntil)));
    const entry = rows[0];
    if (!entry) return null;
    return {
      id: entry.id,
      name: entry.name,
      blobPath: entry.blobPath,
      mimeType: entry.mimeType,
      byteSize: entry.byteSize,
      credit: entry.credit,
      validFrom: entry.validFrom,
      createdBy: entry.createdBy,
    };
  } catch (error) {
    console.error("image-store: active-image lookup failed", error);
    return undefined;
  }
}

export type ConfirmImageResult =
  | { ok: true; name: string }
  | { ok: false; reason: "name-taken" | "error" };

/**
 * Confirms a freshly-uploaded blob by writing its metadata row (version 1) — the
 * row is created only here, never before the blob is in place. Fails with
 * `name-taken` if an active image already uses the name (uniqueness is enforced
 * here, among active images only, so a name can be reused after its image is
 * deleted). Runs in a transaction so the existence check and the insert are
 * atomic.
 */
export async function confirmImage(
  input: {
    name: string;
    blobPath: string;
    mimeType: string;
    byteSize: number;
    credit: string | null;
  },
  userId: string,
): Promise<ConfirmImageResult> {
  const now = new Date();
  try {
    return await getDb().transaction(async (tx) => {
      const existing = await tx
        .select({ id: images.id })
        .from(images)
        .where(and(eq(images.name, input.name), isNull(images.validUntil)));
      if (existing.length > 0) return { ok: false, reason: "name-taken" as const };

      await tx.insert(images).values({
        id: randomUUID(),
        name: input.name,
        blobPath: input.blobPath,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        credit: input.credit,
        createdBy: userId,
        validFrom: now,
        validUntil: null,
        closedBy: null,
      });
      return { ok: true, name: input.name };
    });
  } catch (error) {
    // The pre-check above handles the common case, but the filtered unique index
    // is the real guard against a concurrent confirm racing in after it.
    if (isDuplicateKeyError(error)) return { ok: false, reason: "name-taken" };
    console.error("image-store: confirm failed", error);
    return { ok: false, reason: "error" };
  }
}

export type DeleteImageResult = { ok: true } | { ok: false; reason: "not-found" | "error" };

/**
 * The ONE soft-delete primitive: closes an image's active row (`valid_until` +
 * `closed_by`) on the given transaction executor — `softDeleteImages` loops it over
 * the selected names. A single conditional statement; `not-found` (no active row)
 * is NOT an error, so it never rolls a batch back. A real DB error THROWS so the
 * surrounding transaction rolls back. The blob deletion is the caller's job — it
 * happens OUTSIDE the row transaction.
 */
async function closeActiveImage(
  executor: DbExecutor,
  name: string,
  userId: string,
  now: Date,
): Promise<DeleteImageResult> {
  const closed = await executor
    .update(images)
    .set({ validUntil: now, closedBy: userId })
    .where(and(eq(images.name, name), isNull(images.validUntil)));
  return affectedRows(closed) < 1 ? { ok: false, reason: "not-found" } : { ok: true };
}

// Best-effort blob removal AFTER the row is closed. A blob failure must NEVER fail
// the delete — the row is already gone, the orphaned blob just lingers — so it is
// swallowed with a logged warning. Runs OUTSIDE any DB transaction.
async function deleteBlobBestEffort(blobPath: string): Promise<void> {
  try {
    await deleteBlob(blobPath);
  } catch (error) {
    console.error("image-store: blob delete failed", blobPath, error);
  }
}

export type DeleteImagesResult = { ok: boolean; deleted: number };

/**
 * Bulk soft-delete (the list's "Delete Selected", the only delete path): closes
 * every named image in ONE transaction via the `closeActiveImage` primitive — the
 * list then drops the row, while the full history (including who deleted it) stays.
 * All-or-nothing for the ROWS — any DB error rolls the whole batch back. The backing
 * blobs are removed best-effort, per-image, AFTER the transaction commits (a blob
 * failure never fails the delete). `deleted` counts the rows actually closed (an
 * already-gone name is a no-op success).
 */
export async function softDeleteImages(
  names: string[],
  userId: string,
): Promise<DeleteImagesResult> {
  if (names.length === 0) return { ok: true, deleted: 0 };
  const now = new Date();
  let blobPaths: string[];
  try {
    blobPaths = await getDb().transaction(async (tx) => {
      const closedPaths: string[] = [];
      for (const name of names) {
        const rows = await tx
          .select({ blobPath: images.blobPath })
          .from(images)
          .where(and(eq(images.name, name), isNull(images.validUntil)));
        const active = rows[0];
        if (!active) continue;

        const result = await closeActiveImage(tx, name, userId, now);
        if (result.ok) closedPaths.push(active.blobPath);
      }
      return closedPaths;
    });
  } catch (error) {
    console.error("image-store: bulk delete failed", error);
    return { ok: false, deleted: 0 };
  }
  for (const blobPath of blobPaths) await deleteBlobBestEffort(blobPath);
  return { ok: true, deleted: blobPaths.length };
}
