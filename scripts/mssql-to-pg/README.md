# `novedu-mssql-to-pg` — one-off SQL Server → Postgres data copy

Copies Novedu's 11 `novedu_*` tables from the Azure SQL database to the Postgres database
once, during the coordinated cutover. It is a throwaway: **delete this folder (and
`scripts/db/reset-before-copy.sql`) in the cleanup PR right after the cutover.**

The folder is dependency-isolated — its own `package.json`, its own `node_modules`, no import
from the app — and it is excluded from the root `tsconfig.json` and from Biome, so `npm run
check` / `npm run typecheck` at the repo root never see it.

## What it copies

In this order: `novedu_users`, `novedu_codes`, `novedu_user_chats`, `novedu_recent_codes`,
`novedu_writing_submissions`, `novedu_reports`, `novedu_coding_keys`, `novedu_files`,
`novedu_images`, `novedu_usage_by_code`, `novedu_usage_by_user`.

Column lists are explicit per table (never `SELECT *`), taken from `lib/db/schema.ts`, so
schema drift fails loudly: a column the source no longer has aborts the run before anything is
written, and a column the source has but this script does not copy is reported as a `WARN`
alongside the list that *is* copied.

## What it does NOT copy

- **`mastra_*` / everything in schema `mastra`** — conversations are not migrated. Mastra
  starts empty on Postgres.
- **`novedu_drizzle_migrations`** — the target has its own fresh baseline row, written by the
  app's migrator at boot.
- **Image bytes** — they live in Blob Storage and are untouched by the database move.

## Types

`node-mssql` already returns the shapes Postgres wants, so the mapping is a pass-through:
`bit` → `boolean`, `datetime2` → a UTC `Date` → `timestamptz`, `nvarchar`/`nvarchar(max)` →
`string` → `varchar`/`text`, `int` → `number`. `bigint` counters arrive as decimal **strings**
(node-mssql's default, to keep precision) and are passed through as strings — Postgres accepts
them for `int8`. Anything of an unexpected type aborts the run rather than being coerced.

## Environment

Three variables, exported by the operator (no dotenv is read):

| Variable | Meaning |
| --- | --- |
| `MSSQL_CONNECTION_STRING` | the **source** Azure SQL connection string. SQL auth is used when it carries both `User ID` and `Password`; otherwise passwordless Entra. |
| `DATABASE_URL` | the **target** Postgres URL, e.g. `postgresql://<role>@db-pgnovedu.postgres.database.azure.com/novedu?sslmode=require`. No password in the URL ⇒ an Entra token is used as the password. |
| `STORAGE_TENANT_ID` | the tenant the two data stores live in; the `az login` credential is pinned to it. |

Auth is the operator's own identity: `AzureCliCredential` (pinned to `STORAGE_TENANT_ID`)
chained to `ManagedIdentityCredential`. Run `az login` first. The Postgres role name is the
Entra UPN **as Azure registers it** — for a guest account the `..._domain#EXT#@tenant.
onmicrosoft.com` form — and it must be URL-encoded inside `DATABASE_URL` (`%23EXT%23%40`).

`sslmode=require` (or `verify-full`) in the URL turns on TLS with certificate verification.

## Running it

```bash
cd scripts/mssql-to-pg
npm install

# 1. Dry run — connects to both sides, prints per-table source/target counts and
#    whether each target table is empty, writes NOTHING.
npm start

# 2. The real copy — needs BOTH the flag and the env var.
COPY_CONFIRM=yes npm start -- --execute
```

`npm run dry-run` is the same command as `npm start`; `npm test` runs the pure-helper unit
tests (`node --test`, no database needed).

## Safety rules

- **Dry run is the default.** `--execute` *without* `COPY_CONFIRM=yes` (or the env var without
  the flag) still writes nothing: it prints how to enable the copy and exits 0.
- **A non-empty target is refused.** In execute mode, if *any* of the 11 target tables holds a
  row the script lists them, writes nothing and exits 1 — a rerun can never double rows. Empty
  the target with `scripts/db/reset-before-copy.sql` (as the Entra admin, after `az webapp
  stop`) and run again.
- **Schema drift is refused.** A source table missing one of our columns aborts before any
  write.
- **One transaction per table.** Batched multi-row `INSERT`s (500 rows, or fewer for a wide
  table, so the 65535-parameter limit is never approached) run inside a single
  `begin`/`commit`; any error rolls the whole table back.
- **Counts are asserted.** Every batch checks the rows Postgres reports against the rows it was
  handed, and the run ends with a source/target count table — a mismatch exits 1.
- **No row content is ever logged** — table names, column names and counts only.

## Cutover order

1. `az webapp stop`
2. `scripts/db/reset-before-copy.sql` (Entra admin, on database `novedu`)
3. `select name from public.novedu_drizzle_migrations` must list exactly the
   folder names under `drizzle/` in the image being deployed (Drizzle matches
   applied migrations by folder NAME; a stale row from an earlier baseline makes
   the boot re-run `CREATE TABLE` and abort with 42P07 — with the copied data
   already inside). If it does not match, drop the `novedu_*` tables and the
   bookkeeping table and let one boot recreate them before copying.
4. `COPY_CONFIRM=yes npm start -- --execute` — check the final count table
5. set `DATABASE_URL` on the web app, deploy, `az webapp start`
