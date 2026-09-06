// One-off SQL Server → Postgres data copy for Novedu's 11 `novedu_*` tables.
//
//   npm start                                  dry run: reads both sides, writes nothing
//   COPY_CONFIRM=yes npm start -- --execute    the real copy
//
// Deliberately dependency-isolated: this folder has its own package.json and
// imports NOTHING from the app (the app no longer has an mssql driver). The
// Entra credential chain below is a copy of the app's idea, not an import.
//
// See README.md for the operating instructions and the refusal rules.

import {
  AzureCliCredential,
  ChainedTokenCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sql from "mssql";
import pg from "pg";
import {
  batchSize,
  chunk,
  countStatementMssql,
  countStatementPg,
  diffColumns,
  flattenRows,
  insertStatement,
  selectStatement,
  TABLES,
  type TableSpec,
} from "./tables.ts";

// Azure Database for PostgreSQL's Entra token audience.
const POSTGRES_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";
// The source's largest rows are YAML bodies and report snapshots; 15 s (the
// node-mssql default) is far too tight for a full-table read on a small tier.
const SOURCE_REQUEST_TIMEOUT_MS = 120_000;
const TARGET_STATEMENT_TIMEOUT_MS = 120_000;

function log(message: string): void {
  // Row CONTENT never goes into a log line — table names, column names and
  // counts only.
  console.log(message);
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function requireEnv(name: string, what: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    fail(`${name} is not set — ${what}. Export it before running this script.`);
  }
  return value;
}

/**
 * The same explicit chain the app uses (`lib/azure-credential.ts`): the operator's
 * `az login` identity pinned to the data-store tenant, falling through to a
 * Managed Identity when the CLI is absent. Explicit rather than
 * `DefaultAzureCredential`, which would pick up the app's *sign-in* service
 * principal from `AZURE_*` env vars and authenticate against the wrong tenant.
 */
function buildDataStoreCredential(tenantId: string): TokenCredential {
  return new ChainedTokenCredential(
    new AzureCliCredential({ tenantId }),
    new ManagedIdentityCredential(),
  );
}

/** Source: SQL auth when the string carries both user and password, else Entra. */
export function buildSourceConfig(
  connectionString: string,
  credential: TokenCredential,
): sql.config {
  const config = sql.ConnectionPool.parseConnectionString(connectionString);
  config.requestTimeout = SOURCE_REQUEST_TIMEOUT_MS;
  if (!config.user || !config.password) {
    config.authentication = {
      type: "token-credential",
      options: { credential },
    };
  }
  return config;
}

/**
 * Target: the URL is parsed HERE and the parts handed to pg explicitly.
 * `connectionString` is never passed — pg re-parses it over the explicit fields,
 * which would silently drop the token-as-password callback.
 */
export function buildTargetConfig(url: string, credential: TokenCredential): pg.ClientConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("DATABASE_URL is not a valid URL (expected postgresql://user@host:port/database?...)");
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!database) fail("DATABASE_URL has no database name in its path");

  const user = decodeURIComponent(parsed.username);
  if (!user) fail("DATABASE_URL has no user — the Entra role name is required");
  const rawPassword = parsed.password ? decodeURIComponent(parsed.password) : "";

  const sslmode = parsed.searchParams.get("sslmode");
  const wantsTls = sslmode === "require" || sslmode === "verify-full";

  const config: pg.ClientConfig = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
    user,
    // No password in the URL ⇒ passwordless Entra: the token IS the password.
    // A function is re-invoked per connection attempt, so the token cannot go
    // stale; @azure/identity caches, so this is cheap.
    password: rawPassword
      ? rawPassword
      : async () => {
          const token = await credential.getToken(POSTGRES_SCOPE);
          if (!token) {
            throw new Error(
              "could not obtain an Entra token for Postgres — run `az login` and check STORAGE_TENANT_ID",
            );
          }
          return token.token;
        },
    // Certificate verification stays ON — this is a production data path.
    ...(wantsTls ? { ssl: { rejectUnauthorized: true } } : {}),
    options: "-c TimeZone=UTC",
    statement_timeout: TARGET_STATEMENT_TIMEOUT_MS,
    application_name: "novedu-mssql-to-pg",
  };
  return config;
}

function toCount(value: unknown, what: string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    fail(`${what}: unexpected COUNT result ${JSON.stringify(value)}`);
  }
  return n;
}

async function sourceColumns(pool: sql.ConnectionPool, table: string): Promise<string[]> {
  const result = await pool
    .request()
    .input("table", sql.NVarChar(128), table)
    .query<{ COLUMN_NAME: string }>(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS" +
        " WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION",
    );
  return result.recordset.map((row) => row.COLUMN_NAME);
}

async function sourceCount(pool: sql.ConnectionPool, spec: TableSpec): Promise<number> {
  const result = await pool.request().query<{ n: unknown }>(countStatementMssql(spec));
  return toCount(result.recordset[0]?.n, `source ${spec.table}`);
}

export async function targetCount(client: pg.Client, spec: TableSpec): Promise<number> {
  const result = await client.query<{ n: string }>(countStatementPg(spec));
  return toCount(result.rows[0]?.n, `target ${spec.table}`);
}

type Survey = {
  spec: TableSpec;
  source: number;
  target: number;
  missing: string[];
  extra: string[];
};

async function surveyTable(
  pool: sql.ConnectionPool,
  client: pg.Client,
  spec: TableSpec,
): Promise<Survey> {
  const available = await sourceColumns(pool, spec.table);
  if (available.length === 0) {
    fail(`source table dbo.${spec.table} does not exist (or is not visible to this login)`);
  }
  const { missing, extra } = diffColumns(spec.columns, available);
  return {
    spec,
    missing,
    extra,
    source: await sourceCount(pool, spec),
    target: await targetCount(client, spec),
  };
}

/**
 * Copies one table inside ONE transaction: either the whole table lands or none
 * of it does. Every batch asserts that Postgres reports exactly the rows it was
 * handed.
 */
export async function copyTable(
  pool: sql.ConnectionPool,
  client: pg.Client,
  spec: TableSpec,
): Promise<number> {
  const rows = (await pool.request().query<Record<string, unknown>>(selectStatement(spec)))
    .recordset;
  const size = batchSize(spec.columns.length);
  const batches = chunk(rows, size);

  log(`  ${spec.table}: ${rows.length} rows in ${batches.length} batch(es) of up to ${size}`);
  if (rows.length === 0) return 0;

  let written = 0;
  await client.query("begin");
  try {
    for (const [index, batch] of batches.entries()) {
      const result = await client.query(
        insertStatement(spec, batch.length),
        flattenRows(spec, batch),
      );
      if (result.rowCount !== batch.length) {
        throw new Error(
          `${spec.table} batch ${index + 1}: inserted ${result.rowCount}, expected ${batch.length}`,
        );
      }
      written += batch.length;
      log(`    batch ${index + 1}/${batches.length} — ${written}/${rows.length} rows`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
  return written;
}

function printSurvey(surveys: readonly Survey[]): void {
  const width = Math.max(...surveys.map((s) => s.spec.table.length));
  log("");
  log(`${"table".padEnd(width)}  ${"source".padStart(9)}  ${"target".padStart(9)}  status`);
  log(`${"-".repeat(width)}  ${"-".repeat(9)}  ${"-".repeat(9)}  ------`);
  for (const survey of surveys) {
    const status = survey.target === 0 ? "empty" : "NOT EMPTY";
    log(
      `${survey.spec.table.padEnd(width)}  ${String(survey.source).padStart(9)}` +
        `  ${String(survey.target).padStart(9)}  ${status}`,
    );
  }
  log("");
}

function printComparison(results: readonly { table: string; source: number; target: number }[]): {
  mismatches: number;
} {
  const width = Math.max(...results.map((r) => r.table.length));
  log("");
  log(`${"table".padEnd(width)}  ${"source".padStart(9)}  ${"target".padStart(9)}  result`);
  log(`${"-".repeat(width)}  ${"-".repeat(9)}  ${"-".repeat(9)}  ------`);
  let mismatches = 0;
  for (const row of results) {
    const ok = row.source === row.target;
    if (!ok) mismatches++;
    log(
      `${row.table.padEnd(width)}  ${String(row.source).padStart(9)}` +
        `  ${String(row.target).padStart(9)}  ${ok ? "ok" : "MISMATCH"}`,
    );
  }
  log("");
  return { mismatches };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--execute" && arg !== "--dry-run");
  if (unknown.length > 0) fail(`unknown argument(s): ${unknown.join(" ")}`);
  const executeRequested = args.includes("--execute");
  const confirmed = process.env.COPY_CONFIRM === "yes";

  const sourceConnectionString = requireEnv(
    "MSSQL_CONNECTION_STRING",
    "it is the SOURCE Azure SQL connection string",
  );
  const targetUrl = requireEnv("DATABASE_URL", "it is the TARGET Postgres connection URL");
  const tenantId = requireEnv(
    "STORAGE_TENANT_ID",
    "the Entra credential chain is pinned to the data-store tenant",
  );

  const credential = buildDataStoreCredential(tenantId);
  const sourceConfig = buildSourceConfig(sourceConnectionString, credential);
  const targetConfig = buildTargetConfig(targetUrl, credential);

  log(`source : ${sourceConfig.server}/${sourceConfig.database}`);
  log(`target : ${targetConfig.host}:${targetConfig.port}/${targetConfig.database}`);
  log(`mode   : ${executeRequested && confirmed ? "EXECUTE (writes rows)" : "dry run (read-only)"}`);
  log("skipping mastra_* / schema mastra and novedu_drizzle_migrations by design");

  const pool = new sql.ConnectionPool(sourceConfig);
  const client = new pg.Client(targetConfig);
  await pool.connect();
  try {
    await client.connect();
    try {
      log("");
      log("surveying both sides…");
      const surveys: Survey[] = [];
      for (const spec of TABLES) surveys.push(await surveyTable(pool, client, spec));
      printSurvey(surveys);

      for (const survey of surveys) {
        if (survey.extra.length > 0) {
          log(
            `WARN ${survey.spec.table}: source has column(s) this script does not copy: ` +
              survey.extra.join(", "),
          );
          log(`     copying: ${survey.spec.columns.join(", ")}`);
        }
      }

      const drifted = surveys.filter((survey) => survey.missing.length > 0);
      if (drifted.length > 0) {
        for (const survey of drifted) {
          console.error(
            `ERROR ${survey.spec.table}: source is missing column(s) ${survey.missing.join(", ")}`,
          );
        }
        fail("schema drift — nothing was written; fix tables.ts (or the source) and re-run");
      }

      if (!executeRequested || !confirmed) {
        log("Dry run complete — NOTHING was written.");
        log("");
        log("To perform the real copy:");
        log("  1. stop the web app  (az webapp stop)");
        log("  2. empty the target  (scripts/db/reset-before-copy.sql, as the Entra admin)");
        log("  3. COPY_CONFIRM=yes npm start -- --execute");
        if (executeRequested && !confirmed) {
          log("");
          log("(--execute was given but COPY_CONFIRM=yes was not — treated as a dry run.)");
        }
        return;
      }

      const nonEmpty = surveys.filter((survey) => survey.target > 0);
      if (nonEmpty.length > 0) {
        for (const survey of nonEmpty) {
          console.error(`ERROR target table ${survey.spec.table} holds ${survey.target} row(s)`);
        }
        console.error(
          "Refusing to copy into a non-empty target — a rerun must never double rows.",
        );
        fail("run scripts/db/reset-before-copy.sql as the Entra admin first, then re-run");
      }

      log("copying…");
      const results: { table: string; source: number; target: number }[] = [];
      for (const spec of TABLES) {
        await copyTable(pool, client, spec);
      }

      log("");
      log("verifying counts…");
      for (const spec of TABLES) {
        results.push({
          table: spec.table,
          source: await sourceCount(pool, spec),
          target: await targetCount(client, spec),
        });
      }
      const { mismatches } = printComparison(results);
      if (mismatches > 0) {
        fail(`${mismatches} table(s) differ between source and target`);
      }
      log("Copy complete — all 11 tables match.");
    } finally {
      await client.end();
    }
  } finally {
    await pool.close();
  }
}

// Only run when invoked as the entry point, so the helpers above can be imported
// by a test without kicking off a copy.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? `ERROR: ${error.message}` : error);
    process.exitCode = 1;
  });
}
