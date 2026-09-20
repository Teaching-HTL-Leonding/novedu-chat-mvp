#!/usr/bin/env node
// Operator CLI: provisions ONE stage (database + app role + grants) on the
// Entra-only Postgres Flexible Server `psql-novedu`, or verifies an already
// provisioned one.
//
//   AZURE_CONFIG_DIR=~/.htl-azure-novedu node scripts/db/provision-stage.mjs <dev|prod> [--check]
//
// The statements live in `provision-stage.sql` next to this file; this runner
// only substitutes the stage's identifiers, decides which database each block
// runs on, and skips the two statements Postgres cannot express idempotently
// (`pgaadauth_create_principal`, `create database`). Re-running is therefore
// safe. `--check` touches nothing and exits 1 when an expectation fails.
//
// The server accepts Entra tokens only, so the password is an access token
// fetched from `az` for the ambient profile. It is held in memory, never
// logged, and never part of an error message — which is also why no error path
// here ever echoes a client config.
//
// Plain ESM, Node built-ins plus the app's existing `pg` dependency.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const HOST = "psql-novedu.postgres.database.azure.com";
const PORT = 5432;

/** The server's Entra admin is a security GROUP; members log in under its name. */
const ADMIN_GROUP = "novedu-dev";

/** One database and one Managed-Identity role per stage, on the one server. */
const STAGES = {
  dev: { database: "novedu_dev", appRole: "ca-novedu-dev", devOnly: true },
  prod: { database: "novedu_prod", appRole: "ca-novedu-prod", devOnly: false },
};

/** Defence in depth: `create database` cannot be parameterised, so every
 *  identifier spliced into the template is checked against this first. */
const IDENTIFIER = /^[a-z0-9_-]+$/;

const SQL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "provision-stage.sql");

const USAGE = "usage: node scripts/db/provision-stage.mjs <dev|prod> [--check]";

// ---------------------------------------------------------------------------
// Template handling
// ---------------------------------------------------------------------------

/** Splits the template into `-- @block <name>` sections, in file order. */
function parseBlocks(sql) {
  const blocks = new Map();
  let current = null;
  for (const line of sql.split("\n")) {
    const marker = /^--\s*@block\s+(\S+)\s*$/.exec(line);
    if (marker) {
      current = marker[1];
      blocks.set(current, []);
      continue;
    }
    if (current) blocks.get(current).push(line);
  }
  const parsed = new Map();
  for (const [name, lines] of blocks) parsed.set(name, splitStatements(lines));
  return parsed;
}

/**
 * Splits a block into statements. The template keeps every comment on its own
 * line and contains no semicolon other than a statement terminator, so dropping
 * comment lines and splitting on `;` is exact — and stays readable. Keep the
 * .sql that way rather than growing a real lexer here.
 */
function splitStatements(lines) {
  return lines
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function substitute(sql, stage) {
  for (const value of [stage.database, stage.appRole, ADMIN_GROUP]) {
    if (!IDENTIFIER.test(value)) {
      throw new Error(`refusing to substitute the unsafe identifier "${value}"`);
    }
  }
  return sql
    .replaceAll("{{db}}", stage.database)
    .replaceAll("{{app_role}}", stage.appRole)
    .replaceAll("{{admin_group}}", ADMIN_GROUP);
}

function requireBlock(blocks, name) {
  const statements = blocks.get(name);
  if (!statements || statements.length === 0) {
    throw new Error(`block "${name}" is missing from ${path.basename(SQL_FILE)}`);
  }
  return statements;
}

/** One-line rendering of a statement for the progress log. */
function preview(statement) {
  const flat = statement.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/** Fetches an Entra access token for Postgres from the ambient `az` profile. */
function entraToken() {
  let token;
  try {
    token = execFileSync(
      "az",
      [
        "account",
        "get-access-token",
        "--resource-type",
        "oss-rdbms",
        "--query",
        "accessToken",
        "-o",
        "tsv",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    // Report stderr only: stdout is where the token would have been.
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim().split("\n")[0] : "";
    throw new Error(
      `\`az account get-access-token\` failed${stderr ? ` — ${stderr}` : ""}. Sign in with AZURE_CONFIG_DIR=~/.htl-azure-novedu first.`,
    );
  }
  if (!token) throw new Error("`az account get-access-token` returned an empty token");
  return token;
}

async function connect(database, token) {
  const client = new Client({
    host: HOST,
    port: PORT,
    user: ADMIN_GROUP,
    database,
    password: token,
    // Azure requires TLS with certificate verification — the same setting
    // `lib/db/pool.ts` derives from `sslmode=require`.
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
    application_name: "novedu-provision",
  });
  try {
    await client.connect();
  } catch (error) {
    // Never include the config in the message: it carries the access token.
    throw new Error(
      `cannot connect to ${database} on ${HOST} as "${ADMIN_GROUP}": ${message(error)}`,
    );
  }
  return client;
}

function message(error) {
  const code = error?.code ? ` [${error.code}]` : "";
  return `${error?.message ?? String(error)}${code}`;
}

async function runStatement(client, statement) {
  try {
    await client.query(statement);
  } catch (error) {
    console.log(`  ${preview(statement)} — FAILED`);
    throw new Error(`statement failed: ${preview(statement)}: ${message(error)}`);
  }
  console.log(`  ${preview(statement)} — OK`);
}

/** Runs a block statement by statement (no transaction: `create database`
 *  cannot run inside one). A `skipReason` reports the block instead. */
async function runBlock(client, statements, skipReason) {
  for (const statement of statements) {
    if (skipReason) {
      console.log(`  ${preview(statement)} — skipped (${skipReason})`);
      continue;
    }
    await runStatement(client, statement);
  }
}

async function scalar(client, sql, values) {
  const result = await client.query(sql, values);
  return result.rows[0];
}

async function roleExists(client, role) {
  return Boolean(await scalar(client, "select 1 from pg_roles where rolname = $1", [role]));
}

async function databaseExists(client, database) {
  return Boolean(await scalar(client, "select 1 from pg_database where datname = $1", [database]));
}

// ---------------------------------------------------------------------------
// Provision
// ---------------------------------------------------------------------------

async function provision(stage, blocks, token) {
  console.log(`on database postgres (as "${ADMIN_GROUP}"):`);
  const admin = await connect("postgres", token);
  try {
    const hasRole = await roleExists(admin, stage.appRole);
    await runBlock(
      admin,
      requireBlock(blocks, "postgres:create-principal"),
      hasRole ? `role "${stage.appRole}" already exists` : null,
    );
    const hasDatabase = await databaseExists(admin, stage.database);
    await runBlock(
      admin,
      requireBlock(blocks, "postgres:create-database"),
      hasDatabase ? `database ${stage.database} already exists` : null,
    );
  } finally {
    await admin.end();
  }

  console.log(`on database ${stage.database} (as "${ADMIN_GROUP}"):`);
  const client = await connect(stage.database, token);
  try {
    // In dev a fresh admin session already ACTS AS the app role (the default
    // set by the dev-only block), and the admin statements below would then be
    // refused — so every stage-db session starts by dropping back.
    await runStatement(client, "set role none");
    await runBlock(client, requireBlock(blocks, "stage"), null);
    if (stage.devOnly) await runBlock(client, requireBlock(blocks, "stage:dev-only"), null);
  } finally {
    await client.end();
  }

  console.log(`\nprovisioned ${stage.database} / "${stage.appRole}" — verify with --check.`);
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** Collected expectations; a single FAIL makes the process exit 1. */
const report = [];
const expect = (label, ok, detail) => report.push({ state: ok ? "ok" : "FAIL", label, detail });
const note = (label, detail) => report.push({ state: "n/a", label, detail });

async function check(stage, other, token) {
  const admin = await connect("postgres", token);
  let hasRole = false;
  let hasDatabase = false;
  try {
    hasRole = await roleExists(admin, stage.appRole);
    expect(`app role "${stage.appRole}" exists`, hasRole);

    const owner = await scalar(
      admin,
      "select pg_get_userbyid(datdba) as owner from pg_database where datname = $1",
      [stage.database],
    );
    hasDatabase = Boolean(owner);
    expect(`database ${stage.database} exists`, hasDatabase);
    if (owner) {
      expect(
        `${stage.database} is owned by "${ADMIN_GROUP}"`,
        owner.owner === ADMIN_GROUP,
        owner.owner,
      );
    }

    if (hasRole && hasDatabase) {
      const privileges = await scalar(
        admin,
        `select has_database_privilege($1, $2, 'CONNECT') as app_connect,
                has_database_privilege($1, $2, 'CREATE') as app_create,
                has_database_privilege('public', $2, 'CONNECT') as public_connect`,
        [stage.appRole, stage.database],
      );
      expect(`"${stage.appRole}" has CONNECT on ${stage.database}`, privileges.app_connect);
      expect(`"${stage.appRole}" has CREATE on ${stage.database}`, privileges.app_create);
      expect(`PUBLIC has no CONNECT on ${stage.database}`, !privileges.public_connect);
    }

    // Cross-stage isolation — only meaningful once the other stage exists.
    const otherRole = await roleExists(admin, other.appRole);
    const otherDatabase = await databaseExists(admin, other.database);
    if (hasRole && hasDatabase && otherRole && otherDatabase) {
      const isolation = await scalar(
        admin,
        `select has_database_privilege($1, $2, 'CONNECT') as this_to_other,
                has_database_privilege($3, $4, 'CONNECT') as other_to_this`,
        [stage.appRole, other.database, other.appRole, stage.database],
      );
      expect(`"${stage.appRole}" cannot connect to ${other.database}`, !isolation.this_to_other);
      expect(`"${other.appRole}" cannot connect to ${stage.database}`, !isolation.other_to_this);
    } else {
      note("cross-stage isolation", "other stage not provisioned");
    }

    if (stage.devOnly) {
      const setting = await scalar(
        admin,
        `select s.setconfig from pg_db_role_setting s
           join pg_database d on d.oid = s.setdatabase
           join pg_roles r on r.oid = s.setrole
          where d.datname = $1 and r.rolname = $2`,
        [stage.database, ADMIN_GROUP],
      );
      const config = setting?.setconfig ?? [];
      expect(
        `(${stage.database}, "${ADMIN_GROUP}") defaults to role=${stage.appRole}`,
        config.includes(`role=${stage.appRole}`),
        config.length > 0 ? config.join(" ") : "no per-database setting",
      );
    }
  } finally {
    await admin.end();
  }

  if (!hasDatabase) {
    printReport();
    return;
  }

  let ownership = [];
  const client = await connect(stage.database, token);
  try {
    await client.query("set role none");
    if (hasRole) {
      const schemas = await scalar(
        client,
        `select has_schema_privilege($1, 'public', 'USAGE') as public_usage,
                has_schema_privilege($1, 'public', 'CREATE') as public_create,
                has_schema_privilege($1, 'mastra', 'USAGE') as mastra_usage,
                has_schema_privilege($1, 'mastra', 'CREATE') as mastra_create`,
        [stage.appRole],
      );
      expect(`"${stage.appRole}" has USAGE on public`, schemas.public_usage);
      expect(`"${stage.appRole}" has CREATE on public`, schemas.public_create);
      expect(`"${stage.appRole}" has USAGE on mastra`, schemas.mastra_usage);
      expect(`"${stage.appRole}" has CREATE on mastra`, schemas.mastra_create);
    }
    ownership = await ownershipSummary(client);
  } finally {
    await client.end();
  }

  // A FRESH session, deliberately without `set role none`: this is what a local
  // boot or a Container App start actually gets.
  const fresh = await connect(stage.database, token);
  try {
    // `current_role` / `session_role` are reserved words — alias them plainly.
    const who = await scalar(
      fresh,
      "select current_user as effective_role, session_user as login_role",
    );
    const expected = stage.devOnly ? stage.appRole : ADMIN_GROUP;
    expect(
      `a fresh session in ${stage.database} acts as "${expected}"`,
      who.effective_role === expected,
      `current_user=${who.effective_role} session_user=${who.login_role}`,
    );
  } finally {
    await fresh.end();
  }

  printReport(ownership);
}

async function ownershipSummary(client) {
  const tables = await client.query(
    `select n.nspname as schema, pg_get_userbyid(c.relowner) as owner, count(*)::int as count
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'mastra') and c.relkind in ('r', 'p')
      group by 1, 2 order by 1, 2`,
  );
  const functions = await client.query(
    `select n.nspname as schema, pg_get_userbyid(p.proowner) as owner, count(*)::int as count
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'mastra')
      group by 1, 2 order by 1, 2`,
  );
  return [
    ...tables.rows.map((row) => ({ ...row, kind: "tables" })),
    ...functions.rows.map((row) => ({ ...row, kind: "functions" })),
  ];
}

function printReport(ownership) {
  const width = Math.max(...report.map((entry) => entry.label.length));
  for (const entry of report) {
    const detail = entry.detail ? `  (${entry.detail})` : "";
    console.log(`  ${entry.state.padEnd(4)} ${entry.label.padEnd(width)}${detail}`);
  }
  console.log("\nownership in public + mastra:");
  if (!ownership || ownership.length === 0) {
    console.log("  no objects yet");
  } else {
    for (const row of ownership) {
      console.log(`  ${row.schema}: ${row.count} ${row.kind} owned by "${row.owner}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--check");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (unknown.length > 0 || positional.length !== 1 || !(positional[0] in STAGES)) {
    throw new Error(USAGE);
  }
  const checkOnly = args.includes("--check");
  const stage = STAGES[positional[0]];
  const other = positional[0] === "dev" ? STAGES.prod : STAGES.dev;

  // The default `az` profile belongs to a different tenant; an accidental run
  // against it must never even reach the token call.
  if (!process.env.AZURE_CONFIG_DIR) {
    throw new Error(
      "AZURE_CONFIG_DIR is not set — this server lives in the Novedu tenant, which is only " +
        "reachable through the second az profile. Re-run with " +
        "AZURE_CONFIG_DIR=~/.htl-azure-novedu node scripts/db/provision-stage.mjs " +
        `${positional[0]}${checkOnly ? " --check" : ""}`,
    );
  }

  const sql = substitute(await readFile(SQL_FILE, "utf8"), stage);
  const blocks = parseBlocks(sql);
  const token = entraToken();

  console.log(
    `${checkOnly ? "checking" : "provisioning"} stage ${positional[0]}: ` +
      `database ${stage.database}, app role "${stage.appRole}" on ${HOST}\n`,
  );
  if (checkOnly) {
    await check(stage, other, token);
    if (report.some((entry) => entry.state === "FAIL")) {
      throw new Error(`${report.filter((e) => e.state === "FAIL").length} expectation(s) failed`);
    }
    return;
  }
  await provision(stage, blocks, token);
}

try {
  await main();
} catch (error) {
  console.error(`provision-stage: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
