// The vocabulary of the operator-run image copy tool: the SQL row it works
// from, the two storage seams it talks to, and the manifest entry it writes for
// every row.
//
// The tool is deliberately built around narrow seams so the whole decision logic
// (`core.ts`) is testable against in-memory fakes, and so that the capabilities
// the tool has are visible in one place: it READS the source, READS and WRITES
// the destination, and — for the reverse copy only — writes back to the source.
// NEITHER seam has a delete, overwrite or truncate operation, and nothing here
// can change a `novedu_images` row: the tool cannot destroy data even if it is
// driven wrongly.
//
// OPERATOR TOOLING, never bundled into the app or the CLI (scripts/images/README.md).

/**
 * One `novedu_images` row — every version, active and historical alike.
 * `key` is the row's `blob_path`: the opaque object key that is preserved
 * verbatim across the copy (it is the Blob name at the source and the object
 * directory name at the destination).
 */
export interface ImageRow {
  id: string;
  name: string;
  key: string;
  mimeType: string;
  byteSize: number;
  /** `valid_until IS NULL` — the one live version of this name. */
  active: boolean;
  validFrom: Date;
}

/** One stored object as the source hands it over. */
export interface SourceObject {
  bytes: Uint8Array;
  /** The stored `Content-Type`, or `null` when the object carries none. */
  contentType: string | null;
}

/**
 * The source of truth being migrated FROM: Azure Blob Storage in production,
 * a `Map` in the unit tests. Read-only — there is no delete and no overwrite.
 */
export interface SourceStore {
  /** The object under `key`, or `null` when it does not exist. */
  get(key: string): Promise<SourceObject | null>;
  /** Every object key in the container, for the unreferenced-object inventory. */
  list(): AsyncIterable<string>;
}

/**
 * The source seam PLUS the single write the rollback path needs. Only
 * `reverseCopy` takes this type, so a forward run cannot write to the source
 * even by accident.
 */
export interface WritableSourceStore extends SourceStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/**
 * The destination being migrated TO: the Azure Files share that the running app
 * sees as `IMAGE_STORAGE_ROOT`. `read`/`write` speak in object keys; the
 * `images/<key>/content` layout of `lib/image-fs.ts` lives in the adapter that
 * implements this interface. There is no delete.
 */
export interface DestinationStore {
  /** The published object's bytes, or `null` when the object does not exist. */
  read(key: string): Promise<Uint8Array | null>;
  /** Publishes the bytes under `key`. Only ever called when `read` said `null`. */
  write(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/**
 * What happened to one row.
 *
 * - `copied` — the bytes were published (or, in a dry run, would be) and the
 *   re-read of the destination matched the source checksum.
 * - `skipped-identical` — the destination already held byte-identical content,
 *   so a rerun after an interrupted run is a no-op.
 * - `mismatch` — the destination exists with DIFFERENT content, or (in an audit)
 *   is absent. Reported and left alone; the tool never overwrites.
 * - `missing-active` — the source object of a LIVE row is gone. Fatal: it blocks
 *   the cutover.
 * - `missing-historical` — the source object of a closed row is gone. Expected
 *   (deletes removed backing objects best-effort) and never fabricated.
 * - `size-mismatch` / `mime-mismatch` — the object was copied or already
 *   matched, but its size / `Content-Type` disagrees with the SQL row.
 */
export type ManifestStatus =
  | "copied"
  | "skipped-identical"
  | "mismatch"
  | "missing-historical"
  | "missing-active"
  | "size-mismatch"
  | "mime-mismatch";

/**
 * One line of the manifest — the record of what the tool saw and did for one
 * row. In a REVERSE run the roles swap: `sourceExists`/`sourceSize`/`sha256`
 * describe the object read from the Files share, `sourceContentType` is the SQL
 * row's MIME (the value written back), `destinationPath` names the Blob key, and
 * `destinationSha256` is the re-read of the Blob that was written.
 */
export interface ManifestEntry {
  id: string;
  key: string;
  active: boolean;
  sourceExists: boolean;
  sourceSize: number | null;
  sourceContentType: string | null;
  /** `images/<key>/content` in a forward run, the bare Blob key in a reverse one. */
  destinationPath: string;
  /** SHA-256 of the bytes that were read, `null` when there were none. */
  sha256: string | null;
  /** SHA-256 of the destination as re-read afterwards; `null` when not read. */
  destinationSha256: string | null;
  status: ManifestStatus;
}

/**
 * `dryRun` plans without writing anything; `auditOnly` additionally treats an
 * ABSENT destination as a `mismatch` instead of "would be copied", which is what
 * the pre-start cutover audit needs (it must prove parity, not intent).
 */
export interface CopyOptions {
  dryRun: boolean;
  auditOnly?: boolean;
}

/** The gate in front of the cutover: `ok: false` must stop it. */
export interface AuditVerdict {
  ok: boolean;
  blockers: ManifestEntry[];
}
