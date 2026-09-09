import { createHash } from "node:crypto";
import type {
  AuditVerdict,
  CopyOptions,
  DestinationStore,
  ImageRow,
  ManifestEntry,
  ManifestStatus,
  SourceObject,
  SourceStore,
  WritableSourceStore,
} from "./types";

// ALL of the copy tool's decisions, expressed over the two seams in `types.ts`
// and nothing else — no Azure SDK, no database, no filesystem. That is what
// makes `core.unit.test.ts` able to exercise every branch against in-memory
// fakes, and it keeps the data-safety rules in one readable place:
//
//   * an existing destination object is NEVER overwritten — a divergent one is
//     reported as `mismatch` and left exactly as it is;
//   * a source object is never deleted or modified in a forward run (the seam
//     has no such operation at all);
//   * SQL is never touched: rows arrive as plain data from `rows.ts`;
//   * a missing object on an ACTIVE row blocks the cutover, a missing object on
//     a closed row is recorded as expected historical loss and never fabricated.
//
// Rows are processed one at a time. Objects are at most 5 MB (the app's upload
// cap), so exactly one object is ever held in memory, and a run against a share
// under a stopped app has no concurrency to reason about.
//
// OPERATOR TOOLING, never bundled into the app or the CLI (scripts/images/README.md).

/** The adapter's layout: one directory per object key, holding one `content` file. */
const OBJECTS_DIR = "images";
const CONTENT_FILE = "content";

/** Where `lib/image-fs.ts` expects an object's bytes, relative to the storage root. */
export function destinationPathFor(key: string): string {
  return `${OBJECTS_DIR}/${key}/${CONTENT_FILE}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `image/png; charset=utf-8` and `IMAGE/PNG` are the same media type. */
function mediaType(value: string | null): string | null {
  if (!value) return null;
  const base = value.split(";")[0]?.trim().toLowerCase();
  return base ? base : null;
}

function missingStatus(active: boolean): ManifestStatus {
  return active ? "missing-active" : "missing-historical";
}

/**
 * A copy that succeeded still has to agree with the SQL row: the app serves
 * `Content-Type` and `Content-Length` from the row, so a divergence is a real
 * defect an operator must see. The parity flags only ever REPLACE a benign
 * status — they never mask a `mismatch`, and they never suppress the copy
 * itself (the bytes are the bytes).
 */
function withParity(entry: ManifestEntry, row: ImageRow, object: SourceObject): ManifestEntry {
  if (entry.status !== "copied" && entry.status !== "skipped-identical") return entry;
  if (object.bytes.byteLength !== row.byteSize) return { ...entry, status: "size-mismatch" };
  const declared = mediaType(object.contentType);
  // A source object without a stored `Content-Type` cannot disagree with the row;
  // the manifest records the `null` and the audit stays quiet about it.
  if (declared && declared !== mediaType(row.mimeType)) {
    return { ...entry, status: "mime-mismatch" };
  }
  return entry;
}

/** The record for a row whose object could not be found at all. */
function missingEntry(row: ImageRow, destinationPath: string): ManifestEntry {
  return {
    id: row.id,
    key: row.key,
    active: row.active,
    sourceExists: false,
    sourceSize: null,
    sourceContentType: null,
    destinationPath,
    sha256: null,
    destinationSha256: null,
    status: missingStatus(row.active),
  };
}

/**
 * Copies every row's object from `source` to `dest`, preserving the key, and
 * returns one manifest entry per row.
 *
 * For each row: read the source (absent → `missing-*`), hash it, then look at
 * the destination. An identical destination is skipped, a different one is
 * reported and left alone, and an absent one is written and re-read so the
 * manifest records what actually landed. `dryRun` writes nothing; `auditOnly`
 * additionally refuses to call an absent destination "would be copied".
 */
export async function copyImages(
  rows: ImageRow[],
  source: SourceStore,
  dest: DestinationStore,
  opts: CopyOptions,
): Promise<ManifestEntry[]> {
  const manifest: ManifestEntry[] = [];
  for (const row of rows) {
    manifest.push(await copyOne(row, source, dest, opts));
  }
  return manifest;
}

async function copyOne(
  row: ImageRow,
  source: SourceStore,
  dest: DestinationStore,
  opts: CopyOptions,
): Promise<ManifestEntry> {
  const destinationPath = destinationPathFor(row.key);
  const object = await source.get(row.key);
  if (!object) return missingEntry(row, destinationPath);

  const digest = sha256(object.bytes);
  const entry: ManifestEntry = {
    id: row.id,
    key: row.key,
    active: row.active,
    sourceExists: true,
    sourceSize: object.bytes.byteLength,
    sourceContentType: object.contentType,
    destinationPath,
    sha256: digest,
    destinationSha256: null,
    status: "copied",
  };

  const existing = await dest.read(row.key);
  if (existing) {
    entry.destinationSha256 = sha256(existing);
    // Byte-identical → the rerun of an interrupted run has nothing to do.
    // Different → REPORT, never overwrite: the operator decides.
    entry.status = entry.destinationSha256 === digest ? "skipped-identical" : "mismatch";
  } else if (opts.auditOnly) {
    // An audit proves parity. A destination that is not there does not have it.
    entry.status = "mismatch";
  } else if (opts.dryRun) {
    entry.status = "copied";
  } else {
    // The MIME comes from the SQL row, which is what the app serves.
    await dest.write(row.key, object.bytes, row.mimeType);
    const written = await dest.read(row.key);
    entry.destinationSha256 = written ? sha256(written) : null;
    entry.status = entry.destinationSha256 === digest ? "copied" : "mismatch";
  }

  return withParity(entry, row, object);
}

/** Statuses that must stop a cutover when they land on an ACTIVE row. */
const BLOCKING: ReadonlySet<ManifestStatus> = new Set<ManifestStatus>([
  "missing-active",
  "mismatch",
  "size-mismatch",
  "mime-mismatch",
]);

/**
 * The cutover gate: every LIVE image must have a readable destination object
 * whose bytes, size and MIME agree with its row. Anomalies on closed rows are
 * recorded in the manifest but never block — their objects may legitimately be
 * gone (deletes removed them best-effort long before this migration).
 */
export function auditVerdict(manifest: ManifestEntry[]): AuditVerdict {
  const blockers = manifest.filter((entry) => entry.active && BLOCKING.has(entry.status));
  return { ok: blockers.length === 0, blockers };
}

/**
 * Source objects no `novedu_images` row points at — orphans from interrupted
 * uploads and from rows whose deletion outlived their object. Inventory only:
 * the tool never removes them, and the operator deletes source objects by hand
 * after the soak period.
 */
export async function inventoryUnreferenced(
  source: SourceStore,
  rows: ImageRow[],
): Promise<string[]> {
  const referenced = new Set(rows.map((row) => row.key));
  const unreferenced: string[] = [];
  for await (const key of source.list()) {
    if (!referenced.has(key)) unreferenced.push(key);
  }
  return unreferenced.sort();
}

/**
 * The rollback direction: copies objects written to the FILES share on or after
 * `since` back into Blob Storage, so a redeployed previous release finds them.
 * `since` is the cutover time; rows are selected by `valid_from`.
 *
 * Same safety rules as the forward copy — an existing Blob with different bytes
 * is reported, never overwritten, and nothing is ever deleted. The `Content-Type`
 * written back is the SQL row's (the Files object carries no authoritative one).
 */
export async function reverseCopy(
  rows: ImageRow[],
  dest: DestinationStore,
  source: WritableSourceStore,
  since: Date,
  opts: CopyOptions,
): Promise<ManifestEntry[]> {
  const manifest: ManifestEntry[] = [];
  for (const row of rows) {
    if (row.validFrom.getTime() < since.getTime()) continue;
    manifest.push(await reverseOne(row, dest, source, opts));
  }
  return manifest;
}

async function reverseOne(
  row: ImageRow,
  dest: DestinationStore,
  source: WritableSourceStore,
  opts: CopyOptions,
): Promise<ManifestEntry> {
  const bytes = await dest.read(row.key);
  if (!bytes) return missingEntry(row, row.key);

  const digest = sha256(bytes);
  const entry: ManifestEntry = {
    id: row.id,
    key: row.key,
    active: row.active,
    sourceExists: true,
    sourceSize: bytes.byteLength,
    sourceContentType: row.mimeType,
    destinationPath: row.key,
    sha256: digest,
    destinationSha256: null,
    status: "copied",
  };

  const existing = await source.get(row.key);
  if (existing) {
    entry.destinationSha256 = sha256(existing.bytes);
    entry.status = entry.destinationSha256 === digest ? "skipped-identical" : "mismatch";
  } else if (opts.auditOnly) {
    entry.status = "mismatch";
  } else if (opts.dryRun) {
    entry.status = "copied";
  } else {
    await source.put(row.key, bytes, row.mimeType);
    const written = await source.get(row.key);
    entry.destinationSha256 = written ? sha256(written.bytes) : null;
    entry.status = entry.destinationSha256 === digest ? "copied" : "mismatch";
  }

  return withParity(entry, row, { bytes, contentType: row.mimeType });
}
