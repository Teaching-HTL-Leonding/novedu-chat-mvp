# Postgres database, Drizzle & credentials

Deep reference for how the app talks to its one data store — Azure Database for
PostgreSQL Flexible Server. The always-on invariants are summarized in
`AGENTS.md`; this file has the full mechanics. Read it before touching Mastra
storage (`app/mastra/index.ts`), the Drizzle setup (`lib/db/`), or any of the
`novedu_*` stores.

## Auth rule (password OR Entra ID, chosen from the URL)

The connection config is built in ONE place — **`buildPoolConfig()` in
`lib/db/pool.ts`** — imported by every consumer (Drizzle, the Mastra store, the
e2e helper); never re-implement the parse/override at a call site. It parses
`DATABASE_URL` and chooses the auth mode **from the URL itself**:

1. **Password auth** — the URL carries a password
   (`postgresql://user:pw@host/db`). Dev/test/CI only.
2. **Microsoft Entra ID (passwordless)** — no password in the URL. `password`
   becomes an **async callback** that fetches an Entra access token for scope
   `https://ossrdbms-aad.database.windows.net/.default` via
   `buildDataStoreCredential()`; node-postgres calls the callback for every NEW
   physical connection, so tokens refresh by themselves. This is the default
   and what production uses (Managed Identity).

The choice is purely "does the URL carry a password?" — there is no separate
env flag. The URL is parsed **by hand** with `new URL()`, and `connectionString`
is **never** passed to the `Pool`: node-postgres re-parses a `connectionString`
and lets it override explicit fields, which would silently discard the token
callback.

Any `sslmode` other than `disable` in the URL turns on TLS with certificate
verification (`ssl: { rejectUnauthorized: true }`) — `require`, `verify-full`,
and libpq's `prefer`/`allow`/`verify-ca` alike, so an unrecognised mode can
never silently downgrade to plaintext; a local container URL without `sslmode`
stays plain TCP.

### When to use which (policy)

- **Production is ALWAYS passwordless Entra / Managed Identity.** A production
  `DATABASE_URL` must **never** carry a password — Entra keeps the DB secret
  out of the connection string, which is the whole point.
- **Password auth is a DEV/TEST/CI-ONLY escape hatch** for environments that
  cannot do Entra — the CI service container, a remote coding agent, a machine
  without `az login`. Both paths exist so those environments can still reach
  the database; neither may be removed (dev/test/CI needs password auth, prod
  needs Entra).
- A password-carrying `DATABASE_URL` **is itself a secret** (unlike the
  passwordless Entra URL), so treat it like one wherever it lives.

### The Entra credential chain

When the Entra path is taken, authenticate with an **explicit** credential
chain, never `DefaultAzureCredential`. The chain is `buildDataStoreCredential()`
(`lib/azure-credential.ts`), never hand-built at a call site:

```ts
new ChainedTokenCredential(
  new AzureCliCredential(tenantId ? { tenantId } : {}), // local dev: `az login`
  new ManagedIdentityCredential(),                       // on Azure: system-assigned MI
)
```

`DefaultAzureCredential` would try `EnvironmentCredential` first and pick up
`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` — but those are set for
**user sign-in** (`auth.ts`), in a **different tenant** than the database, so it
would authenticate as the wrong service principal ("server is not configured to
accept this token"). The explicit chain ignores those vars: locally it uses the
`az login` identity in the data-store tenant; on Azure the `az` CLI is absent, so
the CLI credential fails fast and the chain falls through to the app's Managed
Identity.

- **`STORAGE_TENANT_ID`** is the tenant of the Postgres database. It is
  **separate** from the user-sign-in `AZURE_TENANT_ID`. Optional locally — if
  unset, the az credential uses its ambient default tenant. Irrelevant under
  password auth.

### Local dev identity vs. prod identity

The Postgres role name is **the Entra UPN exactly as Azure registers it** — for
a guest account that is the `<local>_<domain>#EXT#@<tenant>.onmicrosoft.com`
form, not the plain e-mail address (the e-mail form is rejected with `28P01`).
In `DATABASE_URL` it must be **URL-encoded** (`#` → `%23`, `@` → `%40`); `new
URL().username` keeps the encoding, so `buildPoolConfig` decodes it with
`decodeURIComponent`. Production uses the identity name `novedu-chat-mvp-at`.
Both go through the same code path — only the role name in the URL differs.

Example URLs:

```
# Local dev, password-less (Entra, guest account)
DATABASE_URL=postgresql://rainer_example.com%23EXT%23%40example.onmicrosoft.com@db-pgnovedu.postgres.database.azure.com/novedu?sslmode=require

# Production, password-less (Managed Identity)
DATABASE_URL=postgresql://novedu-chat-mvp-at@db-pgnovedu.postgres.database.azure.com/novedu?sslmode=require

# Local container, password auth (dev/test/CI only)
DATABASE_URL=postgresql://postgres:Test-Passw0rd!@localhost:5432/novedu
```

## `lib/db/pool.ts` — the one seam

`lib/db/pool.ts` exports `buildPoolConfig(url)`, `getPool()`, `closePool()`
(test teardown only), and `databaseHost(url?)`. It deliberately imports
**nothing but `pg` and the credential builder** — no drizzle, nothing from
`app/**` — so the Playwright e2e helper (`e2e/db.ts`) can call `getPool()`
without pulling the app's query layer into the test runner.

`getPool()` returns **one `pg.Pool` per process**, cached on `globalThis` so
Next.js HMR reloads in dev reuse it instead of leaking a new pool per reload.
It throws a clear error (`"DATABASE_URL is not set — database storage is
unavailable"`) when the env var is missing, and attaches a `pool.on("error",
…)` listener so an error on an **idle** pooled client (a server restart, a
network drop, an Azure maintenance failover) is logged instead of crashing the
process as an unhandled event.

The pool is bounded and pinned:

- `max: 20` — Drizzle and the Mastra store share these clients. Dev, prod, and
  every Playwright worker share one small server (`max_connections = 50` on
  `db-pgnovedu`'s B1ms tier), so the one production process takes at most 20
  and leaves the rest for developers, e2e runs and admin sessions.
- `connectionTimeoutMillis: 10_000` — a checkout waits at most 10 s for a free
  client. Without it node-postgres queues forever when the pool is exhausted or
  the server is unreachable, so requests would hang instead of failing into the
  stores' never-throw paths (and `/health` would never report it).
- `idleTimeoutMillis: 30_000`.
- `statement_timeout: 60_000`: the app's largest writes (Mastra messages
  carrying base64 photo attachments) must not be cut off, but a runaway
  statement must still fail loudly. This applies **per statement**.
- `options: "-c TimeZone=UTC"` — pins the session timezone to UTC as a defence.
  The app's own queries are written timezone-independently (`date_trunc(...,
  'UTC')`, `timestamptz` columns), but `now()` and any ad-hoc expression still
  follow the session setting.
- `application_name: "novedu"`.

`databaseHost(url)` returns the URL's hostname (or `null` when unset/
unparseable) for the `/health` dashboard's DNS probe (probe key `db-host`,
label "Database host", test id `health-db-host`; `checkDb` still round-trips
through Mastra storage — see `lib/health.ts`).

## One pool, two consumers

Both consumers take the **same** `getPool()` handle — one pool, one auth
decision, no lifecycle mismatch:

1. **The app's Drizzle handle** (`lib/db/index.ts`, `getDb()` — `drizzle({
   client: getPool() })`, no `schema`/`relations` registered, since every
   store builds its statements from the table objects in `./schema` directly
   and `db.query.*` is unused). Owns the `novedu_*` tables in the `public`
   schema.
2. **Mastra** (`app/mastra/index.ts`): `new PostgresStore({ id:
   "mastra-storage", pool: getPool(), schemaName: "mastra" })` (`@mastra/pg`).
   A pool passed in via `pool:` is never closed by Mastra, so there is no
   lifecycle coupling. One domain is deliberately swapped out: the
   **workflows domain runs in-memory** (`WorkflowsInMemory`). Every agent run
   writes a transient "pending" agentic-loop snapshot at start, reads it back,
   and deletes it at the end — three database round trips per turn for state
   nothing here ever resumes (no suspend/approval flows), so they stay in
   process memory. Threads/messages (Mastra Memory) stay in Postgres, in
   schema `mastra`.

Unset `DATABASE_URL` → the app boots without persistence (warns; the boot
sequence skips migrations); chat then fails because tutor codes and the tutor
agent's memory need the database.

## Privilege model

The web app's Postgres role is a **plain login role** — not superuser, no
`CREATEDB` / `CREATEROLE`, and **not the database owner**. It holds `CONNECT` +
`CREATE` on `novedu` and `USAGE` + `CREATE` on exactly two schemas: `public`
(the app-owned `novedu_*` tables, migrated by Drizzle at boot) and `mastra`
(pre-created by provisioning; Mastra's own tables are created inside it by
`initMastraStorage()`). `CREATE` on the *database* only permits creating
schemas; it is required because Drizzle's migrator always runs `CREATE SCHEMA
IF NOT EXISTS` for its bookkeeping schema (`public`) before anything else, and
Postgres checks that privilege before the `IF NOT EXISTS` shortcut — without it
the boot fails with `permission denied for database`. `REVOKE CREATE ON
SCHEMA public FROM public` closes the default-open schema, so nothing but the
app role (and the admin) may create objects there. The role **OWNS the tables
it creates at boot** — Drizzle's migrations in `public`, Mastra's `init()` in
`mastra` — and nothing else.

**Why not DML-only.** Mastra's `init()` runs `CREATE TABLE IF NOT EXISTS` /
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on every boot, even when nothing
needs creating — and Postgres refuses `ALTER TABLE` for a non-owner. A
DML-only grant (`SELECT`/`INSERT`/`UPDATE`/`DELETE` without ownership) would
make every boot against an up-to-date schema fail. Table ownership is
therefore the app role's actual runtime requirement, not an over-grant.

**Revisit point.** A future Row-Level Security step (part of the multi-tenant
roadmap) changes this calculus: table **owners bypass RLS** unless a table is
marked `FORCE ROW LEVEL SECURITY`. That is the point to decide on a stricter
split (a separate owner role, out-of-band migrations, a DML-only app role) —
not before RLS is actually on the table.

**Provisioning.** `scripts/db/provision.sql` is the one-time setup, run once by
the server's Entra admin: on the `postgres` database,
`pgaadauth_create_principal('novedu-chat-mvp-at', false, false)` registers the
Managed Identity as a role, then `create database novedu`; on `novedu`,
`create schema mastra`, the `revoke create on schema public from public`, and
the `grant` statements above. A developer's own `az login` role is made a
**member** of the app role (`grant "novedu-chat-mvp-at" to "<developer role>"`,
the script's third block): membership confers the app role's privileges on every
table it owns, so local dev needs no per-table grants — and this applies to the
Entra admin too, which owns the database but none of the tables. The developer's
Postgres role name is the Entra UPN as Azure registers it (for a guest account
the `user_domain#EXT#@tenant.onmicrosoft.com` form), which is also what the
user part of a local `DATABASE_URL` must carry, URL-encoded.

**Ownership hazard on the shared database.** Dev and prod share this one
server. Whenever a developer's own `az login` identity is the first to boot a
new migration (or a Mastra upgrade) against it, the objects it creates or
alters land owned by that developer — and the production identity, holding no
grant on tables it doesn't own, is locked out of them until ownership is
reassigned. `scripts/db/reassign-ownership.sql` is the documented remedy: an
idempotent `DO` block that `ALTER … OWNER TO`s every table/view/sequence in
`public` and `mastra` not already owned by `novedu-chat-mvp-at`, skipping
sequences that belong to a table (those move with it), plus a second block for
functions — Mastra's boot also runs `CREATE OR REPLACE FUNCTION
mastra.trigger_set_timestamps()`, which only the function's owner may do (a
foreign-owned function fails with `42501`; the app still boots, but every
restart logs the exception). Run the script as the Entra admin after any such
local-first boot.

## App-owned schema (`novedu_*`) & Drizzle workflow

- Schema lives in **`lib/db/schema.ts`** (`drizzle-orm/pg-core`); SQL
  migrations are generated with **`npm run db:generate`** (drizzle-kit, no DB
  connection needed) into the committed **`drizzle/`** folder — one baseline
  folder today (`migration.sql` + `snapshot.json`, drizzle-kit v1 layout; no
  `meta/_journal.json`).
- Migrations are applied **automatically at server startup**
  (`instrumentation.ts` → `lib/db/migrate.ts`, `drizzle-orm/node-postgres/migrator`),
  bookkept in **`novedu_drizzle_migrations`**. `migrationsSchema` is pinned to
  `public` on purpose (the driver's default is a *separate* `drizzle` schema;
  the bookkeeping belongs beside the tables it tracks). The migrator still
  runs `CREATE SCHEMA IF NOT EXISTS "public"` on every boot, which is why the
  app role holds `CREATE` on the database (see "Privilege model"). A failed
  migration aborts startup on purpose.
- Startup then calls **`initMastraStorage()`** (`app/mastra/index.ts`) to
  create Mastra's own `mastra.*` tables. `PostgresStore` does that itself, but
  only **lazily** — on the store's first use, i.e. the first agent run — and
  `lib/code-stats-store.ts` reads `mastra.mastra_threads` /
  `mastra.mastra_messages` *directly*, so on a database where no agent has run
  yet a teacher's code detail page would degrade to "Stats temporarily
  unavailable". Doing it at boot keeps the contract simple: **once startup
  finishes, every table this server reads exists.** Fails loud, same as a
  migration failure. The Dockerfile copies `drizzle/` into the standalone
  image. (`instrumentation.ts` has a second, independent duty — bringing up
  telemetry *before* migrations and exporting the `onRequestError` hook; that
  is gated on its own connection string and documented in
  **`docs/telemetry.md`**.)
- **HARD RULE: no foreign keys between `novedu_*` and `mastra_*` tables.**
  Mastra owns its data model; relationships are by-value (see `docs/codes.md`
  for the join model). There is also deliberately no FK `novedu_user_chats →
  novedu_codes` and none for `novedu_recent_codes` (shortcuts join at read
  time).

### Type mapping

`lib/db/schema.ts` maps its columns as follows: bounded/key columns are
`varchar(n)`; unbounded free text (YAML bodies, report snapshots, saved
student texts, `note`, `description`, `title`, `credit`, `display_name`,
`llm_model`, `model`, `file_url`, `origin`) is `text` (Postgres stores it
exactly like a `varchar`, with no length ceiling — the cap on a bounded column
documents the value's shape and is enforced by the database, not only by the
app-side clamps that mirror it); timestamps are `timestamp({ withTimezone:
true, mode: "date" })` (`timestamptz`, always UTC); flags are `boolean`;
token counters are `bigint({ mode: "number" })` (they arrive from the driver
as strings and drizzle converts them); discrete counts are `integer`.

### Partial unique indexes

`novedu_files` and `novedu_images` are the repo's **temporal (append-only)
tables**, sharing one model: each row is one version, the *active* version is
the single row with `valid_until IS NULL`, and "at most one active version per
name" is enforced by a **Postgres partial unique index**:
`uniqueIndex(...).on(t.name).where(sql\`${t.validUntil} IS NULL\`)`. Update =
close the active row + insert a new one; delete = close only. See
`docs/files.md` (and `docs/images.md`) for the full model and the matching
optimistic-concurrency guard.

### Upserts and duplicate-key handling

Increment/overwrite writes are single `INSERT … ON CONFLICT … DO UPDATE`
statements: `user-name-store`, `recent-code-store`, and `writing-store` each
upsert one row; both `usage-store` increments add onto existing counters
(`col = table.col + excluded.col`) and COALESCE-fill the nullable
`provider`/`model` columns (`provider = COALESCE(table.provider,
excluded.provider)`) so the first writer with that knowledge wins.
`user-chat-store` uses `ON CONFLICT DO NOTHING` (a duplicate simply means
"already linked").

Real duplicate-key **branches** (code minting retries, a file/image
`name-taken` check, the coding-key mint loop) go through the shared
**`isUniqueViolation()`** in `lib/db/errors.ts`: Postgres reports a
unique-constraint violation as SQLSTATE `23505`, and drizzle wraps the driver
error so the code sits on a nested `cause` rather than the thrown error
itself — `isUniqueViolation` walks up to 10 levels of `cause` looking for it.
Conditional `UPDATE`s (e.g. the optimistic-concurrency guard on
`novedu_files`/`novedu_images`) read node-postgres's `rowCount`, falling back
to `0` when it is absent.

## Table inventory

Tables (details in `docs/codes.md`):

| Table | Keys | Purpose |
| --- | --- | --- |
| `novedu_codes` | PK `code` | Shareable codes across modules: `module` discriminator, file URL, window, note, creating teacher, frozen `anonymous` flag |
| `novedu_user_chats` | PK `thread_id` | user↔chat attribution (only when the activity opts out of anonymity) |
| `novedu_recent_codes` | PK (`user_id`, `code`) | a user's recently used codes (entry-page shortcuts) |
| `novedu_writing_submissions` | PK (`code`, `user_id`) | a student's saved writing text — one upserted row per student per code, non-anonymous codes only (details in `docs/writing.md`) |
| `novedu_reports` | PK `id` | student-submitted reports on an AI interaction, always attributed to the reporter's oid even under an anonymous code (details in `docs/reports.md`) |
| `novedu_coding_keys` | PK (`code`, `user_id`); unique index on `api_key` | the coding module's per-user API keys — one stable `nvk-…` key per student per coding code, the second sanctioned user↔code attribution (details in `docs/coding.md`) |
| `novedu_users` | PK `user_id` | Entra `oid` → display name, upserted on sign-in; LEFT-JOINed by value to resolve a shown user id to a name (details in `docs/auth.md`) |
| `novedu_files` | PK `id` (per-version); partial UK `name WHERE valid_until IS NULL` | App-hosted YAML files, **temporal/append-only** (details in `docs/files.md`) |
| `novedu_images` | PK `id` (per-version); partial UK `name WHERE valid_until IS NULL` | App-hosted image metadata (bytes in Blob Storage), **temporal/append-only** (details in `docs/images.md`) |
| `novedu_usage_by_code` | PK (`code`, `hour`) | per-hour token/tool/activity counts by code, no user (details in `docs/usage-metering.md`) |
| `novedu_usage_by_user` | PK (`user_id`, `hour`) | per-hour token/tool/activity counts by user, no code (details in `docs/usage-metering.md`) |
| `novedu_drizzle_migrations` | — | Drizzle migration bookkeeping (schema `public`) |

Mastra's own tables live in schema `mastra` (`mastra_threads`, `mastra_messages`,
`mastra_resources`, `mastra_workflow_snapshot`, `mastra_evals`, `mastra_traces`,
`mastra_scorers`, `mastra_notifications`); their camelCase columns (e.g.
`"resourceId"`, `"createdAt"`) must be double-quoted in any raw SQL that reads
them, since Postgres lower-cases an unquoted identifier.

Rows from a raw `db.execute(sql\`…\`)` bypass drizzle's column mappers: the
node-postgres session returns every timestamp as its wire string and
`COUNT`/`SUM` as bigint strings. A store that reads them converts explicitly
(`new Date(row.firstAt)`, `Number(row.total)`), as `lib/code-stats-store.ts`
and `lib/usage-stats-store.ts` do.

## Deletion (no garbage collection)

There is **no** automatic garbage collection. Codes and their conversation
data live until a teacher deletes them on `/codes` via "Delete Selected" (the
only delete path). The bulk delete (`deleteCodesAndData` in
`lib/code-stats-store.ts`) removes, per selected code:

1. every Mastra thread under `resourceId = code` and its messages — through
   Mastra's OWN storage API (`getStore("memory").deleteThread`, which deletes a
   thread's messages and the thread in one transaction), so we never mutate the
   `mastra.*` schema by hand;
2. the app-owned rows via Drizzle, all in **one transaction**: the selected codes'
   `novedu_coding_keys` rows first (one batched statement for the whole selection —
   the only path that ever deletes them), then per code `novedu_user_chats`,
   `novedu_recent_codes`, `novedu_writing_submissions`, `novedu_reports`, and
   finally the `novedu_codes` row LAST (so a mid-way failure leaves the code
   still listed and the operation safe to retry; it is idempotent).

The READ side of stats — counts, per-conversation timings — is plain by-value
SQL against `mastra.mastra_threads`/`mastra.mastra_messages`; see `docs/codes.md`.

## One-off data copy

`scripts/mssql-to-pg/` is a standalone, dependency-isolated tool (its own
`package.json`, excluded from the root `tsconfig.json` and from Biome) that
copies the 11 `novedu_*` tables from a source database into this one, table by
table, in a fixed dependency order, inside one transaction per table. It
**dry-runs by default** — connecting to both sides and printing per-table row
counts and target-emptiness without writing anything — and its real copy
**refuses a non-empty target table**, so a rerun can never double rows. See
`scripts/mssql-to-pg/README.md` for the exact environment variables and
invocation. `scripts/db/reset-before-copy.sql` is the paired admin-run remedy
for the refusal: run only in a coordinated cutover (never by the app, never
against a database serving traffic), it `TRUNCATE`s every `novedu_*` table and
every table in schema `mastra`, leaving `novedu_drizzle_migrations` alone —
clearing the way for a fresh copy into the tables the app's own migrator and
`initMastraStorage()` already created.
