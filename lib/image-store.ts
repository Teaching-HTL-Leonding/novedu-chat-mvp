import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, type SQL } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/lib/db";
import { authUsers } from "@/lib/db/auth-schema";
import { countRows } from "@/lib/db/count";
import { classifyDbFailure, isUniqueViolation } from "@/lib/db/errors";
import type { OwnerOption } from "@/lib/db/owner-filter";
import { listOwners, ownerJoin, ownerLabel } from "@/lib/db/owners";
import { type PagedResult, type Paging, paginate } from "@/lib/db/paging";
import { affectedRows } from "@/lib/db/result";
import { images } from "@/lib/db/schema";
import { type SortColumns, sortOrder } from "@/lib/db/sort-order";
import type { Sort } from "@/lib/db/sorting";
import { containsAny } from "@/lib/db/text-filter";
import { validateFileName } from "@/lib/file-name";
import { deleteObject } from "@/lib/image-fs";
import { IMAGE_ID_PATTERN } from "@/lib/image-ref";

// Persistence for app-hosted image metadata in the `novedu_images` SQL table. The
// bytes live in the configured image storage root (one object per row, keyed by
// `blob_path` — see `lib/image-fs.ts`); this table only tracks metadata. The
// table is TEMPORAL/append-only: each row is
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
// SERVER-ONLY: uses node:crypto, the database and the filesystem adapter. Never
// import from client components.

// The "this is the live version" predicate. EVERY query here goes through it, so
// the temporal filter can never drift between the list, the lookups, the insert
// pre-check and the delete.
function activeRow() {
  return isNull(images.validUntil);
}

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
  /** Session user id of the writer of the active version. */
  createdBy: string;
}

/**
 * An image as the `/images` LIST shows it: the entry plus its OWNER's display name,
 * LEFT-JOINed from `novedu_user` by value — `null` when that teacher has never
 * signed in through the web app, in which case the page falls back to the raw user id.
 * "Owner" is the last writer here (see `createdBy` above), the word the UI and the
 * teacher guide use.
 */
export type ImageListRow = ImageListEntry & { ownerName: string | null };

/** The active version of one image. Metadata only — the bytes live in the storage root. */
export type ActiveImage = ImageListEntry;

// The list's WHERE, built once and shared by the COUNT and the row query — they
// must never drift, or a page's total would describe a different set than its rows.
function listConditions(opts?: { search?: string; createdBy?: string }): SQL[] {
  const conditions: SQL[] = [activeRow()];
  const term = opts?.search?.trim();
  if (term) {
    const match = containsAny(term, [images.name]);
    if (match) conditions.push(match);
  }
  if (opts?.createdBy) conditions.push(eq(images.createdBy, opts.createdBy));
  return conditions;
}

// The row's owner name (display-only; see `ownerJoin`) and the label the `owner`
// sort key orders by — the same coalesced expression the dropdown shows, so the
// column sorts by exactly what it displays.
const JOIN_OWNER = ownerJoin(images.createdBy);
const OWNER_LABEL = ownerLabel(images.createdBy);

/** The `/images` list's sortable columns (ORDER BY map + `parseSort` allow-list). */
export const IMAGE_SORT_COLUMNS = {
  name: images.name,
  mime: images.mimeType,
  size: images.byteSize,
  credit: images.credit,
  owner: OWNER_LABEL,
  updated: images.validFrom,
} satisfies SortColumns;

/**
 * The distinct owners (last writers) of the active images, for the `/images` owner
 * dropdown. Base conditions only — see `listOwners`. Never throws.
 */
export async function listImageOwners(): Promise<OwnerOption[]> {
  return listOwners(images, images.createdBy, listConditions());
}

/**
 * The active (non-deleted) images for the "Images" list, newest first unless a
 * `sort` says otherwise. Filtering
 * happens IN THE DATABASE (see `docs/filtered-lists.md`), never in memory: an
 * optional `search` term is a case-insensitive contains-match over the name, and
 * `createdBy` narrows to one writer's images (the owner dropdown).
 * `undefined` on a database error, which the page notes.
 *
 * `paging` makes the SKIP and the LIMIT part of the SQL too (`LIMIT/OFFSET`,
 * with a COUNT for the total), and `sort` the ORDER BY — so a sort spans the whole
 * filtered set, not one page. Omitting both returns every match in the default
 * order, which is what the bearer API route wants.
 */
export async function listImages(opts?: {
  search?: string;
  createdBy?: string;
  paging?: Paging;
  sort?: Sort;
}): Promise<PagedResult<ImageListRow> | undefined> {
  const conditions = listConditions(opts);
  try {
    return await paginate({
      paging: opts?.paging,
      count: () => countRows(images, conditions),
      // A FRESH builder per call — drizzle builders are stateful and `paginate`
      // may invoke this twice (once more after clamping an over-shot page).
      rows: (window) => {
        const query = getDb()
          .select({
            id: images.id,
            name: images.name,
            blobPath: images.blobPath,
            mimeType: images.mimeType,
            byteSize: images.byteSize,
            credit: images.credit,
            validFrom: images.validFrom,
            createdBy: images.createdBy,
            ownerName: authUsers.name,
          })
          .from(images)
          .leftJoin(authUsers, JOIN_OWNER)
          .where(and(...conditions))
          .orderBy(
            ...sortOrder(opts?.sort, IMAGE_SORT_COLUMNS, [desc(images.validFrom)], asc(images.id)),
          );
        return window ? query.limit(window.limit).offset(window.offset) : query;
      },
    });
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
      .where(and(eq(images.name, valid.name), activeRow()));
    return toActiveImage(rows[0]);
  } catch (error) {
    console.error("image-store: active-image lookup failed", error);
    return undefined;
  }
}

/**
 * The active version by its per-version row id — what `GET /api/image-content/<id>`
 * re-checks on EVERY byte request, so a deleted or replaced image stops being
 * served immediately. `null` for a malformed id (no query at all) and for a row
 * that is closed or unknown; `undefined` on a database error.
 */
export async function getActiveImageById(id: string): Promise<ActiveImage | null | undefined> {
  if (typeof id !== "string" || !IMAGE_ID_PATTERN.test(id)) return null;
  try {
    const rows = await getDb()
      .select()
      .from(images)
      .where(and(eq(images.id, id), activeRow()));
    return toActiveImage(rows[0]);
  } catch (error) {
    console.error("image-store: active-image lookup by id failed", error);
    return undefined;
  }
}

// The one row → `ActiveImage` mapping both lookups share.
function toActiveImage(entry: typeof images.$inferSelect | undefined): ActiveImage | null {
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
}

export type CreateImageResult =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: "name-taken" }
  | { ok: false; reason: "error"; outcome: "definite" | "uncertain" };

/**
 * Writes the metadata row (version 1) for an image whose object is already in
 * place, and returns the new per-version `id` — the value the byte URL is built
 * from. Fails with `name-taken` if an active image already uses the name
 * (uniqueness is enforced here, among active images only, so a name can be
 * reused after its image is deleted). Runs in a transaction so the existence
 * check and the insert are atomic.
 *
 * A failure carries the `outcome` of the SQL attempt: `definite` means the
 * server answered and nothing was written (the caller may delete the object it
 * just wrote), `uncertain` means the connection broke and the insert may have
 * committed — the object must then be left alone (docs/images.md).
 */
export async function createImage(
  input: {
    name: string;
    blobPath: string;
    mimeType: string;
    byteSize: number;
    credit: string | null;
  },
  userId: string,
): Promise<CreateImageResult> {
  const now = new Date();
  const id = randomUUID();
  try {
    return await getDb().transaction(async (tx) => {
      const existing = await tx
        .select({ id: images.id })
        .from(images)
        .where(and(eq(images.name, input.name), activeRow()));
      if (existing.length > 0) return { ok: false, reason: "name-taken" as const };

      await tx.insert(images).values({
        id,
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
      return { ok: true, id, name: input.name };
    });
  } catch (error) {
    // The pre-check above handles the common case, but the partial unique index
    // is the real guard against a concurrent insert racing in after it — it
    // rejected a second active row for the same name, SQLSTATE 23505.
    if (isUniqueViolation(error)) return { ok: false, reason: "name-taken" };
    console.error("image-store: creating the image row failed", error);
    return { ok: false, reason: "error", outcome: classifyDbFailure(error) };
  }
}

export type DeleteImageResult = { ok: true } | { ok: false; reason: "not-found" | "error" };

/**
 * The ONE soft-delete primitive: closes an image's active row (`valid_until` +
 * `closed_by`) on the given transaction executor — `softDeleteImages` loops it over
 * the selected names. A single conditional statement; `not-found` (no active row)
 * is NOT an error, so it never rolls a batch back. A real DB error THROWS so the
 * surrounding transaction rolls back. Removing the object is the caller's job —
 * it happens OUTSIDE the row transaction.
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
    .where(and(eq(images.name, name), activeRow()));
  return affectedRows(closed) < 1 ? { ok: false, reason: "not-found" } : { ok: true };
}

// Best-effort object removal AFTER the row is closed. A storage failure must
// NEVER fail the delete — the row is already closed, the orphaned object just
// lingers until it is reconciled — so it is only logged. An object that was
// already gone is a note, not an error. Runs OUTSIDE any DB transaction.
async function deleteObjectBestEffort(key: string): Promise<void> {
  const result = await deleteObject(key);
  if (!result.ok) {
    console.error("image-store: object delete failed", key, result.reason, result.detail);
    return;
  }
  if (!result.existed) console.warn("image-store: object already missing", key);
}

export type DeleteImagesResult = { ok: boolean; deleted: number };

/**
 * Bulk soft-delete (the list's "Delete Selected", the only delete path): closes
 * every named image in ONE transaction via the `closeActiveImage` primitive — the
 * list then drops the row, while the full history (including who deleted it) stays.
 * All-or-nothing for the ROWS — any DB error rolls the whole batch back. The backing
 * objects are removed best-effort, per-image, AFTER the transaction commits (a
 * storage failure never fails the delete). `deleted` counts the rows actually closed
 * (an already-gone name is a no-op success).
 */
export async function softDeleteImages(
  names: string[],
  userId: string,
): Promise<DeleteImagesResult> {
  if (names.length === 0) return { ok: true, deleted: 0 };
  const now = new Date();
  let keys: string[];
  try {
    keys = await getDb().transaction(async (tx) => {
      const closedPaths: string[] = [];
      for (const name of names) {
        const rows = await tx
          .select({ blobPath: images.blobPath })
          .from(images)
          .where(and(eq(images.name, name), activeRow()));
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
  for (const key of keys) await deleteObjectBestEffort(key);
  return { ok: true, deleted: keys.length };
}
