# Azure storage (SQL + Table) & credentials

Deep reference for how the app talks to Azure storage. The always-on invariants are
summarized in `AGENTS.md`; this file has the full mechanics. Read it before touching
Mastra storage (`app/mastra/index.ts`) or the share-link table
(`lib/share-link-store.ts`).

## Credential rule (applies to BOTH stores)

Authenticate with an **explicit** credential chain, never `DefaultAzureCredential`.
The chain is built in ONE place — **`buildDataStoreCredential()` in
`lib/azure-credential.ts`** — and imported by both stores; never hand-build it at a
call site:

```ts
new ChainedTokenCredential(
  new AzureCliCredential(tenantId ? { tenantId } : {}), // local dev: `az login`
  new ManagedIdentityCredential(),                       // on Azure: system-assigned MI
)
```

`DefaultAzureCredential` would try `EnvironmentCredential` first and pick up
`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` — but those are set for
**user sign-in** (`auth.ts`), in a **different tenant** than the data stores, so it
would authenticate as the wrong service principal ("server is not configured to
accept this token"). The explicit chain ignores those vars: locally it uses the
`az login` identity in the data-store tenant; on Azure the `az` CLI is absent, so the
CLI credential fails fast and the chain falls through to the app's Managed Identity.

- **`STORAGE_TENANT_ID`** is the single tenant var shared by the SQL DB and the
  storage account (they live in the same tenant — `022e4faf-…`). It is **separate**
  from the user-sign-in `AZURE_TENANT_ID`. Optional locally — if unset, the az
  credential uses its ambient default tenant.

## Azure SQL (Mastra memory/storage)

- Built in `app/mastra/index.ts` as `MSSQLStore` (`@mastra/mssql`) from
  `MSSQL_CONNECTION_STRING`. The ADO.NET `Authentication=...` keyword is NOT understood
  by node-mssql and is overridden in code with Entra auth.
- Auth uses tedious's `token-credential` type — a `TokenCredential` *object* (the chain
  above), NOT a pre-fetched token string. This lets tedious call `getToken()` per pooled
  connection, so tokens auto-refresh.
- The `mastra_*` schema is auto-created on first use (the identity needs table-creation
  rights once, e.g. `db_owner`). Unset `MSSQL_CONNECTION_STRING` → the app boots without
  persistence (warns); chat then fails because the tutor agent's memory needs a store.

## Azure Table Storage (stored share links / short URLs)

- `lib/share-link-store.ts` stores every created share link: account
  `AZURE_STORAGE_ACCOUNT_NAME` (`stnoveduchatmvp` in prod, RG `Novedu-Chat-MVP`),
  table `novedusharedlinks`, PartitionKey = creating teacher's `session.user.id`
  (Entra `sub`), RowKey = 10 random `[a-z0-9]` chars (crypto-secure; on a 409 key
  collision the store retries with a fresh code). Columns: tutor, start, end, sig,
  origin. This backs the short URL `/?link=<code>` shown next to the full link on
  `/share-tutor`. The `origin` column is **operator documentation only** (tells DEV
  from PROD rows in the table browser) — resolution never reads it and tolerates
  rows without it, so a short code works on ANY origin (created on localhost,
  opened in prod).
- The table is **created automatically before the first write** (idempotent
  `createTable`; the "Storage Table Data Contributor" role includes table creation),
  so a fresh storage account needs no manual provisioning — mirroring the SQL
  store's auto-created schema. Reads never provision: a missing table just resolves
  no codes.
- The storage account has **shared-key access DISABLED** — access is Entra-only.
  Consequence: `az storage` data-plane commands need `--auth-mode login`, and Portal
  table browsing needs "Microsoft Entra authentication" mode.
- Data-plane roles on the account: "Storage Table Data Contributor" (and "Storage Blob
  Data Owner", reserved for future tutor-YAML blobs) for the dev user and the web app's
  system-assigned Managed Identity.
- Resolution precedence and verification of `/?link=<code>` are documented in
  `docs/share-links.md` — the table is only an index; the HMAC signature remains the
  security boundary.
- Storage is OPTIONAL and degrades: store failure at creation → full link + warning,
  no short link (`ShareLinkFormState.warning`); lookup failure → `unknown-code` /
  `lookup-failed` reasons in `app/share-link-error.tsx`. After every successful
  store, the creating user's expired links (`end < now`) are garbage-collected
  (`gcExpiredShareLinks`) — scheduled via `next/server`'s `after()`, so the cleanup
  runs once the teacher's form response is already sent.
