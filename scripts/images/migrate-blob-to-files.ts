import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { buildDataStoreCredential } from "@/lib/azure-credential";
import { buildPoolConfig } from "@/lib/db/pool";
import { blobSource, filesDestination } from "./azure";
import { auditVerdict, copyImages, inventoryUnreferenced, reverseCopy } from "./core";
import { loadImageRows } from "./rows";
import type { ImageRow, ManifestEntry, ManifestStatus } from "./types";

//   npm run images:migrate -- [--dry-run | --audit] [--manifest <path>]
//   npm run images:migrate -- --reverse --since <iso> [--dry-run]
//
// The operator-run copy tool that moves app-hosted image BYTES from Azure Blob
// Storage to the Azure Files share the app mounts as `IMAGE_STORAGE_ROOT`. It is
// run from a developer machine with `az login`; nothing migration-related ships
// in the production image, and no `scripts/**` file is imported by the app or
// bundled into the CLI.
//
// What it can and cannot do (scripts/images/README.md has the full runbook):
//
//   * It NEVER deletes a source object and never modifies one — the source seam
//     has no delete at all, and the rollback write is create-only.
//   * It NEVER writes SQL. `novedu_images` is read once; `blob_path` values are
//     preserved verbatim, so no row needs to change and none does.
//   * It NEVER overwrites a destination object that already exists with
//     different bytes — that is reported as `mismatch` and left alone.
//   * It exits 1 when the audit finds a blocker (an active row without a
//     readable, matching destination object). Only a clean run permits the
//     cutover.
//
// OPERATOR TOOLING, never bundled into the app or the CLI (scripts/images/README.md).

const USAGE = `Usage:
  npm run images:migrate -- [options]

Modes:
  (default)            copy every missing object from Blob to the Files share, then audit
  --dry-run            plan only: read and compare, write nothing
  --audit              verify parity only: write nothing, and treat an absent
                       destination object as a mismatch (the cutover gate)
  --reverse --since <iso>
                       rollback: copy objects written on or after <iso> from the
                       Files share back to Blob (Content-Type from the SQL row)

Options:
  --manifest <path>    where to write the JSON manifest
                       (default scripts/images/manifest-<timestamp>.json)
  --account <name>     storage account (default $IMAGE_STORAGE_ACCOUNT)
  --container <name>   source Blob container (default $IMAGE_BLOB_CONTAINER)
  --share <name>       destination file share (default $IMAGE_FILE_SHARE or novedu-files)
  --help               print this text

Requires DATABASE_URL and an \`az login\` identity holding Storage Blob Data
Reader on the container and Storage File Data Privileged Contributor on the
account. The tool never deletes source objects and never writes SQL.`;

interface Options {
  dryRun: boolean;
  auditOnly: boolean;
  reverse: boolean;
  since: Date | null;
  manifest: string | null;
  account: string | null;
  container: string | null;
  share: string | null;
}

type Parsed = { ok: true; options: Options } | { ok: false; message: string };

function parseArgs(argv: string[]): Parsed | { ok: true; help: true } {
  const options: Options = {
    dryRun: false,
    auditOnly: false,
    reverse: false,
    since: null,
    manifest: null,
    account: null,
    container: null,
    share: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      index += 1;
      return next;
    };
    switch (arg) {
      case "--help":
      case "-h":
        return { ok: true, help: true };
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--audit":
        options.auditOnly = true;
        options.dryRun = true;
        break;
      case "--reverse":
        options.reverse = true;
        break;
      case "--since": {
        const raw = value();
        if (!raw) return { ok: false, message: "--since needs an ISO timestamp." };
        const since = new Date(raw);
        if (Number.isNaN(since.getTime())) {
          return { ok: false, message: `--since is not a valid timestamp: ${raw}` };
        }
        options.since = since;
        break;
      }
      case "--manifest":
      case "--account":
      case "--container":
      case "--share": {
        const raw = value();
        if (!raw) return { ok: false, message: `${arg} needs a value.` };
        const key = arg.slice(2) as "manifest" | "account" | "container" | "share";
        options[key] = raw;
        break;
      }
      default:
        return { ok: false, message: `Unknown argument: ${arg}` };
    }
  }

  if (options.reverse && !options.since) {
    return { ok: false, message: "--reverse needs --since <iso> (the cutover time)." };
  }
  return { ok: true, options };
}

type ResolvedConfig =
  | { ok: true; databaseUrl: string; account: string; container: string; share: string }
  | { ok: false; message: string };

/**
 * Everything the run needs, checked BEFORE any client is built and before the
 * database or Azure is touched at all — a misconfigured run must fail on the
 * spot with a message that names what is missing, not halfway through a copy.
 */
function resolveConfig(options: Options): ResolvedConfig {
  const missing: string[] = [];
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) missing.push("DATABASE_URL (the novedu_images metadata database)");

  const account = (options.account ?? process.env.IMAGE_STORAGE_ACCOUNT ?? "").trim();
  if (!account) missing.push("--account or IMAGE_STORAGE_ACCOUNT (the storage account name)");

  const container = (options.container ?? process.env.IMAGE_BLOB_CONTAINER ?? "").trim();
  if (!container) missing.push("--container or IMAGE_BLOB_CONTAINER (the source Blob container)");

  const share = (options.share ?? process.env.IMAGE_FILE_SHARE ?? "novedu-files").trim();
  if (!share) missing.push("--share or IMAGE_FILE_SHARE (the destination file share)");

  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `images:migrate: cannot start — missing configuration:\n  - ${missing.join("\n  - ")}\n` +
        "Nothing was read or written. See scripts/images/README.md.",
    };
  }
  return { ok: true, databaseUrl, account, container, share };
}

/** One read of every image row; the pool is opened and closed around it. */
async function readRows(databaseUrl: string): Promise<ImageRow[]> {
  const pool = new Pool(buildPoolConfig(databaseUrl));
  try {
    return await loadImageRows(pool);
  } finally {
    await pool.end();
  }
}

function countByStatus(manifest: ManifestEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of manifest) {
    const status: ManifestStatus = entry.status;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function defaultManifestPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(process.cwd(), "scripts", "images", `manifest-${stamp}.json`);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    console.log(USAGE);
    return 0;
  }
  if (!parsed.ok) {
    console.error(`${parsed.message}\n\n${USAGE}`);
    return 1;
  }
  const { options } = parsed;

  // Load `.env` the way Next does, so a developer machine's DATABASE_URL and
  // storage settings are visible without exporting them by hand.
  loadEnvConfig(process.cwd());

  const config = resolveConfig(options);
  if (!config.ok) {
    console.error(config.message);
    return 1;
  }

  const mode = options.reverse ? "reverse" : options.auditOnly ? "audit" : "copy";
  console.log(
    `images:migrate: ${mode}${options.dryRun ? " (dry run — nothing is written)" : ""}\n` +
      `  account   ${config.account}\n  container ${config.container}\n  share     ${config.share}`,
  );

  const rows = await readRows(config.databaseUrl);
  console.log(`  rows      ${rows.length} (${rows.filter((row) => row.active).length} active)`);

  const credential = buildDataStoreCredential();
  const source = blobSource(config.account, config.container, credential);
  const dest = filesDestination(config.account, config.share, credential);
  const copyOptions = { dryRun: options.dryRun, auditOnly: options.auditOnly };

  // `--reverse` without `--since` never gets past `parseArgs`, so the cutover
  // time is present here whenever the reverse branch runs.
  const since = options.since;
  const manifest =
    options.reverse && since
      ? await reverseCopy(rows, dest, source, since, copyOptions)
      : await copyImages(rows, source, dest, copyOptions);

  // Orphans are INVENTORIED, never touched — the operator deletes source objects
  // by hand after the soak period.
  const unreferenced = options.reverse ? [] : await inventoryUnreferenced(source, rows);

  const manifestPath = options.manifest
    ? path.resolve(process.cwd(), options.manifest)
    : defaultManifestPath();
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        dryRun: options.dryRun,
        account: config.account,
        container: config.container,
        share: config.share,
        since: options.since?.toISOString() ?? null,
        rowCount: rows.length,
        statusCounts: countByStatus(manifest),
        unreferencedSourceKeys: unreferenced,
        entries: manifest,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  for (const [status, count] of Object.entries(countByStatus(manifest)).sort()) {
    console.log(`  ${status.padEnd(20)} ${count}`);
  }
  if (unreferenced.length > 0) {
    console.log(`  unreferenced source objects (not touched): ${unreferenced.length}`);
  }
  console.log(`  manifest  ${manifestPath}`);

  const verdict = auditVerdict(manifest);
  if (!verdict.ok) {
    console.error(
      `\nimages:migrate: ${verdict.blockers.length} active image(s) are NOT safe to cut over:`,
    );
    for (const blocker of verdict.blockers) {
      console.error(`  ${blocker.status.padEnd(20)} ${blocker.key} (row ${blocker.id})`);
    }
    return 1;
  }

  console.log("\nimages:migrate: every active image has a matching destination object.");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("images:migrate: failed —", error);
    process.exitCode = 1;
  });
