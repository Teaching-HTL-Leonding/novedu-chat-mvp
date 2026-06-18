# Azure SQL database, Drizzle & credentials

Deep reference for how the app talks to its one data store — the Azure SQL
database. The always-on invariants are summarized in `AGENTS.md`; this file has
the full mechanics. Read it before touching Mastra storage
(`app/mastra/index.ts`), the Drizzle setup (`lib/db/`), or any of the
`novedu_*` stores.

## Auth rule (SQL user/password OR Entra ID)

The connection config is built in ONE place — **`buildMssqlConnectionConfig()` in
`lib/azure-credential.ts`** — imported by every pool (Mastra, Drizzle, the e2e
helper); never re-implement the parse/override at a call site. It parses
`MSSQL_CONNECTION_STRING` and chooses the auth mode **from the string itself**:

1. **SQL auth** — the string carries `User ID=...;Password=...` (node-mssql parses
   these into `config.user` / `config.password`). The config is left untouched, so
   tedious does a classic SQL Server login with that username/password. No Azure
   credential is constructed.
2. **Microsoft Entra ID (passwordless)** — no SQL credentials in the string. The
   builder attaches tedious's `token-credential` auth backed by
   **`buildDataStoreCredential()`** (see below). This is the default and what prod
   uses (Managed Identity).

The choice is purely "are `User ID` + `Password` present in the string?" — there is
no separate env flag.

### When to use which (policy)

- **Production is ALWAYS passwordless Entra / Managed Identity.** A prod
  `MSSQL_CONNECTION_STRING` must **never** carry `User ID`/`Password` — Entra keeps
  the DB secret out of the connection string, which is the whole point.
- **SQL auth is a DEV/TEST-ONLY escape hatch** for environments that cannot do
  Entra — e.g. a remote coding agent or CI box with no `az login` and no Managed
  Identity. Both code paths exist so those environments can still reach the DB;
  neither path may be removed (dev/test needs SQL, prod needs Entra).
- A SQL `User ID`/`Password` connection string **is itself a secret** (unlike the
  passwordless Entra string), so treat it like one wherever it lives.

### The Entra credential chain

When the Entra path is taken, authenticate with an **explicit** credential chain,
never `DefaultAzureCredential`. The chain is `buildDataStoreCredential()`, never
hand-built at a call site:

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
`az login` identity in the data-store tenant; on Azure the `az` CLI is absent, so the
CLI credential fails fast and the chain falls through to the app's Managed Identity.

- **`STORAGE_TENANT_ID`** is the tenant of the SQL database. It is **separate**
  from the user-sign-in `AZURE_TENANT_ID`. Optional locally — if unset, the az
  credential uses its ambient default tenant. Irrelevant under SQL auth.

## Two pools, one database

Both pools are built from `MSSQL_CONNECTION_STRING` through
`buildMssqlConnectionConfig()` (the SQL-or-Entra decision above). On the Entra path,
node-mssql does not understand the ADO.NET `Authentication=...` keyword, so auth is
attached in code with tedious's `token-credential` type — a `TokenCredential`
*object*, NOT a pre-fetched token string, so tedious calls `getToken()` per pooled
connection and tokens auto-refresh:

1. **Mastra** (`app/mastra/index.ts`): `MSSQLStore` (`@mastra/mssql`) owns the
   `mastra_*` tables and **auto-creates/migrates its own schema** on first use.
   We never touch that schema.
2. **The app's Drizzle handle** (`lib/db/index.ts`, `getDb()`): owns the
   `novedu_*` tables, defined in `lib/db/schema.ts`. Separate pool on purpose —
   no lifecycle coupling with Mastra's.

Unset `MSSQL_CONNECTION_STRING` → the app boots without persistence (warns;
instrumentation skips migrations); chat then fails because tutor codes and
the tutor agent's memory need the database.

## App-owned schema (`novedu_*`) & Drizzle workflow

- Schema lives in **`lib/db/schema.ts`**; SQL migrations are generated with
  **`npm run db:generate`** (drizzle-kit, no DB connection needed) into the
  committed **`drizzle/`** folder.
- Migrations are applied **automatically at server startup**
  (`instrumentation.ts` → `lib/db/migrate.ts`), bookkept in
  `novedu_drizzle_migrations`. A failed migration aborts startup on purpose.
  The Dockerfile copies `drizzle/` into the standalone image. (`instrumentation.ts`
  has a second, independent duty — bringing up telemetry *before* migrations and
  exporting the `onRequestError` hook; that is gated on its own connection string
  and documented in **`docs/telemetry.md`**.)
- The SQL identity needs DDL rights once (the prod Managed-Identity user is
  `db_owner`).
- **HARD RULE: no foreign keys between `novedu_*` and `mastra_*` tables.**
  Mastra owns its data model; relationships are by-value (see
  `docs/tutor-codes.md` for the join model). There is also deliberately no FK
  `novedu_user_chats → novedu_tutor_codes` and none for `novedu_recent_codes`
  (shortcuts join at read time).

Tables (details in `docs/tutor-codes.md`):

| Table | Keys | Purpose |
| --- | --- | --- |
| `novedu_tutor_codes` | PK `code` | Shared tutor codes: tutor URL, window, note, creating teacher, frozen `anonymous` flag |
| `novedu_user_chats` | PK `thread_id` | user↔chat attribution (only for `anonymous: false` tutors) |
| `novedu_recent_codes` | PK (`user_id`, `code`) | a user's recently used codes (entry-page shortcuts) |
| `novedu_files` | PK `id` (per-version); filtered UK `name WHERE valid_until IS NULL` | App-hosted YAML files, **temporal/append-only** (details in `docs/files.md`) |
| `novedu_drizzle_migrations` | — | Drizzle migration bookkeeping |

`novedu_files` is the repo's one **temporal (append-only) table**: each row is one
version of a file, the *active* version is the single row with `valid_until IS NULL`,
and "at most one active version per name" is enforced by a SQL Server **filtered
unique index** (`drizzle-orm`'s `uniqueIndex(...).on(name).where(sql\`valid_until IS NULL\`)`).
Update = close the active row + insert a new one; delete = close only. See
`docs/files.md` for the full model and the matching optimistic-concurrency guard.

## Deletion (no garbage collection)

There is **no** automatic garbage collection. Tutor codes and their conversation
data live until a teacher deletes a code on `/tutor-codes`. The delete action
(`deleteTutorCodeAndData` in `lib/tutor-stats-store.ts`) removes, for that code:

1. every Mastra thread under `resourceId = code` and its messages — through
   Mastra's OWN storage API (`getStore("memory").deleteThread`, which deletes a
   thread's messages and the thread in one transaction), so we never mutate the
   `mastra_*` schema by hand;
2. the app-owned rows via Drizzle — `novedu_user_chats`, `novedu_recent_codes`,
   then the `novedu_tutor_codes` row LAST (so a mid-way failure leaves the code
   still listed and the operation safe to retry; it is idempotent).

(Earlier versions ran an hourly in-process timer that deleted expired codes; it
and `lib/tutor-code-gc.ts` were removed so a code's stats stay reachable after
its window closes. The READ side of stats — counts, per-conversation timings —
is plain by-value SQL against `mastra_threads`/`mastra_messages`; see
`docs/tutor-codes.md`.)

## History

Earlier versions stored share links in Azure Table Storage
(`stnoveduchatmvp`/`novedusharedlinks`, Entra-only auth). That dependency is
gone — the storage account and table are no longer used by the app and can be
deleted by an operator.
