# Image copy tool (Blob → Azure Files)

Operator tooling: it copies app-hosted image **bytes** between the Azure Blob
container the previous release read and the Azure Files share the app mounts as
`IMAGE_STORAGE_ROOT`. It is run by hand from a developer machine with
`az login`; nothing here ships in the production image, is imported by the app,
or is bundled into the CLI.

Metadata is never touched. `novedu_images.blob_path` is an opaque object key
that is preserved verbatim on both sides, so the copy needs no schema change and
writes no SQL.

```sh
npm run images:migrate -- --dry-run                      # plan: read and compare, write nothing
npm run images:migrate --                                # copy what is missing, then audit
npm run images:migrate -- --audit                        # verify parity only (the cutover gate)
npm run images:migrate -- --reverse --since <iso>        # rollback direction
npm run images:migrate -- --help
```

## What it does

For every `novedu_images` row — active and historical alike — it reads the source
object, hashes it, compares size and `Content-Type` with the row, and publishes
the bytes at `images/<key>/content` on the share, the exact layout
`lib/image-fs.ts` reads back. The destination is re-read afterwards so the
manifest records the checksum that actually landed.

Every run writes a JSON manifest (`--manifest <path>`, default
`scripts/images/manifest-<timestamp>.json`) holding one entry per row — id, key,
source existence, source size and content type, destination path, both SHA-256
values, and a status:

| Status | Meaning |
| --- | --- |
| `copied` | The bytes were published (in a dry run: would be) and the re-read matched. |
| `skipped-identical` | The destination already held byte-identical content. |
| `mismatch` | The destination exists with different content, or (in an audit) is absent. Reported, never overwritten. |
| `missing-active` | The source object of a **live** row is gone. Fatal. |
| `missing-historical` | The source object of a closed row is gone. Expected, never fabricated. |
| `size-mismatch` / `mime-mismatch` | The object crossed, but disagrees with its SQL row. |

Source objects no row points at are inventoried in the manifest
(`unreferencedSourceKeys`) and left alone.

The run exits `1` when any **active** row is not safe to cut over
(`missing-active`, `mismatch`, `size-mismatch`, `mime-mismatch`); anomalies on
closed rows are recorded but never block. Manifests are operator artifacts —
keep them out of commits.

## Data-safety rules

- Never deletes or modifies a source object: the source seam has no delete
  operation at all, and the rollback write is create-only (`ifNoneMatch: "*"`).
- Never overwrites a destination object. A divergent one is reported and left
  exactly as it is.
- Never writes SQL — no `INSERT`, `UPDATE`, `DELETE`. Both rules are pinned by
  source-text guards in `core.unit.test.ts`.
- Never provisions the storage root. The `.novedu-files-root` sentinel is the
  operator's explicit step, so a copy run cannot turn a wrong share into a
  plausible storage root.
- Deleting source objects after the soak period is manual and outside this tool.

## Prerequisites

- `az login` as an identity holding **Storage Blob Data Reader** on the source
  container and **Storage File Data Privileged Contributor** on the storage
  account. Files data-plane access goes over REST with
  `fileRequestIntent: "backup"`, so no SMB mount and no port 445 are needed here.
  Authentication is passwordless Entra throughout (`buildDataStoreCredential()`)
  — never an account key, SAS, or connection string.
- `DATABASE_URL` for the `novedu_images` metadata database (read once). A
  passwordless URL authenticates through the same credential.
- Storage settings, from `.env` or flags: `IMAGE_STORAGE_ACCOUNT` /`--account`,
  `IMAGE_BLOB_CONTAINER` /`--container`, `IMAGE_FILE_SHARE` /`--share`
  (default `novedu-files`).

Missing configuration fails on the spot, before the database or Azure is
touched.

## Cutover

Uploads are rare, deletes are bulk-only, and production runs one instance with
one worker, so the cutover is a short planned downtime — there is no write fence
and no drain.

1. Provision the share: `IMAGE_STORAGE_ROOT=<mounted path> npm run images:init-root`
   (directory, `images/`, the exact sentinel bytes), and check that the
   container's `nextjs` uid can write `<root>/images`.
2. Bulk-copy while the app still runs: `npm run images:migrate --`. Re-run until
   it exits `0`; a rerun after an interruption only copies what is missing.
3. **Stop the web app.**
4. Final delta plus gate: `npm run images:migrate --`, then
   `npm run images:migrate -- --audit`. The audit reads both sides and proves
   every active row has a readable, matching destination object. Only a clean
   audit (`exit 0`) permits the start.
5. Set `IMAGE_STORAGE_ROOT`, remove the Blob app settings, start the new
   release, and confirm the `images` health probe reports the mounted root.

## Rollback

Rollback during the soak period is a release switch: redeploy the previous image
with the previous app settings. The Blob container is never modified by the
copy, so every object the previous release knew still exists.

The one divergence is images uploaded **after** the cutover. Copy those back
before the previous release resumes:

```sh
npm run images:migrate -- --reverse --since <cutover-iso> --dry-run
npm run images:migrate -- --reverse --since <cutover-iso>
```

Rows are selected by `valid_from`, the bytes come from the share, and the
`Content-Type` written back is the SQL row's — the Files object carries no
authoritative one.

## Files and tests

| File | Role |
| --- | --- |
| `types.ts` | The row, the two store seams, the manifest entry. Neither seam has a delete. |
| `core.ts` | Every decision: `copyImages`, `auditVerdict`, `inventoryUnreferenced`, `reverseCopy`. No Azure, no database, no filesystem. |
| `rows.ts` | `loadImageRows(pool)` — the single read of `novedu_images`. |
| `azure.ts` | `blobSource()` and `filesDestination()`, the only Azure code. |
| `migrate-blob-to-files.ts` | Flags, configuration checks, manifest, exit code. |

`core.unit.test.ts` (hermetic, `npm run test:unit -- scripts/images`) exercises
the whole decision logic against in-memory fakes.
`e2e/image-migration-rows.live.spec.ts` (`@live @live-db`) covers the row
classification against real Postgres.
