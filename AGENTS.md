<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

### Rules

- Register all agents, tools, workflows, and scorers in `app/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly

### Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)

## Research Drizzle ORM

Before you create complex DB interactions (e.g. complex queries, transactions, complex migrations), research the [Drizzle ORM documentation](https://orm.drizzle.team/llms.txt) to ensure you are using the best patterns and practices for your use case. Drizzle has powerful features that can simplify your code and improve performance, but you might not have the latest information on them built-in.

## Pushing Changes to GitHub

Do **NOT** push changes to GitHub if not explitly told by the user.

## Architecture notes & subsystem docs

`CLAUDE.md` is a symlink to **`AGENTS.md`** — edit `AGENTS.md`.

Deep reference for each subsystem lives in `docs/`. These files are **NOT** auto-loaded
into context — read the linked file BEFORE working in that area. The invariants listed
inline below always apply, even when you don't open the doc.

### Authentication, teacher roles & student mode → `docs/auth.md`

Read it before touching `auth.ts`, `proxy.ts`, sessions, teacher gating, or student mode.
Invariants:

- The app is gated by Microsoft Entra ID (Auth.js v5). The gate is **`proxy.ts`** at the
  repo root — in Next 16 the `middleware` convention was renamed to `proxy`.
- Gate teacher-only server actions / route handlers with **`requireEffectiveTeacher()`**
  from `lib/student-mode.ts` (it honors "view as student" mode) — **NEVER**
  `session.user.isTeacher` or `requireTeacher()` directly, which ignore the mode.

### Tutor Codes (chat entry, sharing, user↔chat mapping) → `docs/tutor-codes.md`

Read it before touching the chat entry points (`app/page.tsx`, `app/[code]/page.tsx`),
the tutor-code create/edit pages (`/tutor-codes/new`, `/tutor-codes/edit/[code]`),
the list page (`/tutor-codes`), the stats pages (`/tutor-codes/[code]` and
`/tutor-codes/[code]/c/[threadId]`), the chat runtime route, or the `novedu_*` /
`tutor-stats` stores in `lib/`. Invariants:

- The chat is reachable **only** via `/<tutor-code>` (10-char `[a-z0-9]` code). The
  stored `novedu_tutor_codes` row gates ACCESS, and `checkTutorCode()` is enforced
  server-side in **BOTH** `app/[code]/page.tsx` and the CopilotKit route
  (`app/api/copilotkit/[[...slug]]/route.ts`, header `x-tutor-code`, re-checked on
  every DATA request — `run`/`connect`/`stop`; GET `/info` is auth-only metadata)
  — keep both in sync.
- Thread ISOLATION is the `x-thread-token` ownership token (`lib/thread-token.ts`):
  `app/[code]/page.tsx` generates the thread id and signs `(code, userId, threadId)`;
  the CopilotKit route verifies it on every thread-touching request and 404s all
  runtime endpoints the app does not use. Mastra does NOT bind threads to a
  resource — without the token any code-holder could read others' chats. The
  STUDENT chat path uses this token; the TEACHER side is **role-gated, not
  owner-gated**: any *effective teacher* may view/edit/delete ANY code and read
  ANY code's stats/conversations (`getTutorCode`, no `created_by` check) — a
  larger RBAC feature is planned. `created_by` is still recorded (and drives the
  "Only my codes" filter default). The session user id is the Entra **`oid`**
  (object id), NOT `sub` — see `docs/auth.md`.
- The **`/tutor-codes` list shows ALL codes** with a text + "Only my codes"
  filter applied **in the database** (URL search params → SQL `WHERE`, never in
  memory) — the shared filtered-list concept (`docs/filtered-lists.md`). Create
  is `/tutor-codes/new` (a "New Tutor Code" button on the list; the old
  `/share-tutor` route redirects there). **Editing** a code (`/tutor-codes/edit/[code]`,
  `updateTutorCode`) changes only the **note + availability window** — never the
  tutor URL or the frozen `anonymous` flag.
- Mastra memory `resourceId` = the tutor code. `novedu_user_chats` is the ONLY
  user↔chat link and is written **only** for tutors whose stored `anonymous` flag is
  `false` (default: anonymous, nothing stored) — that promise is why thread ownership
  is a stateless HMAC, not a table. `anonymous` is the tutor YAML's flag **frozen
  onto the `novedu_tutor_codes` row at create time** (a later YAML edit does not
  change it); the stats page reads it to decide whether to show per-student data.
- Tutor codes are NOT garbage-collected — they (and their conversation data) live
  until a teacher deletes a code from `/tutor-codes`, which wipes the code plus all
  of its Mastra threads/messages (`deleteTutorCodeAndData`). So the list shows
  expired codes too; an expired code's chat won't open but its stats stay reachable.

### App-hosted YAML Files (authoring, versioning, public serving) → `docs/files.md`

Read it before touching `app/files/*`, `app/api/files/*`, `lib/file-store.ts`,
`lib/files-actions.ts`, the `novedu_files` schema, or the `api/files` matcher entry
in `proxy.ts`. Invariants:

- **All file CRUD is teacher-only**, gated in the server actions with
  **`requireTeacherUserId()`** (an *effective* teacher + the session `oid`) — never
  `session.user.isTeacher`. **Saving validates first**: `validateFileContent`
  re-runs the tutor/fragment validator before any write, so an invalid file is never
  persisted. The standalone **Validate** button (`validateNewFileAction` /
  `validateExistingFileAction`) runs the same validator but **never stores**.
- The public **`GET /api/files/<name>`** endpoint is **unauthenticated** — it must
  stay in the `proxy.ts` negative-lookahead matcher (with `api/auth`, `api/version`);
  **keep the route and the matcher in sync**. All CRUD lives in server actions on
  authed pages, not under `/api/files`.
- `novedu_files` is **temporal / append-only**: each row is one version, the active
  version is the single row with `valid_until IS NULL`, soft-delete only (history
  kept). **`lib/file-store.ts` is the ONLY access** to the table. "One active version
  per name" is enforced by the DB **filtered unique index `ux_novedu_files_active_name`**;
  names are reusable after deletion. Files are NOT garbage-collected.
- The `/files` list filters (text + "Only my files") **in the database**
  (`listFiles({ search, createdBy })`, URL search params → SQL `WHERE`/`LIKE`,
  never in memory) — the shared filtered-list concept (`docs/filtered-lists.md`).
- **`lib/yaml-files.ts` is the documented FACADE** over these file actions +
  validators + types — the single, client-safe import the student GUI module uses,
  and dogfooded by the create/edit forms. It must NOT import `lib/file-store.ts`
  (server-only). The pure name/kind helpers were extracted to **`lib/file-name.ts`**
  so the facade can re-export them without pulling the DB in.

### Student YAML GUI module (`app/files/gui/*`) → `docs/yaml-gui-student-contribution.md`

A form-based GUI alternative to the CodeMirror editor, built by students in an
isolated workspace. Read it before touching `app/files/gui/*`, `lib/yaml-files.ts`,
or the two placeholder buttons. Invariants:

- **`app/files/gui/_studio/**` is student-owned**; the two `page.tsx` files
  (`edit/[...name]`, `view`) are **APP-OWNED route shells** that gate (teacher-only),
  do the server-only load (DB / URL), and render the student components with plain
  props — keep these as the boundary. The `_studio` underscore keeps the folder out
  of routing.
- The students' **only** app import is **`@/lib/yaml-files`** (functions + types) —
  never app components or other `@/lib/*`. This is a **convention** (review /
  CODEOWNERS), not lint-enforced. They write **client-side React only**; new server
  behaviour means extending the facade, not adding student server code.
- The **"Edit in GUI"** link lives in the `/files` list Actions column
  (`/files/gui/edit/<name>`) and **"View in GUI"** on `/validate-tutor`
  (`/files/gui/view?url=…&kind=…`).
- `loadYamlFromUrlAction` reuses the **same** self/relative/app-hosted resolution as
  the save-time validator (`appHostedFetcher` in `lib/files-actions.ts`) — one
  definition of how an app-hosted URL resolves from the DB instead of a loopback fetch.

### Filtered lists (shared list UI: filter spot, action spot, table) → `docs/filtered-lists.md`

Read it before touching `components/data-list.tsx`, `components/list-filter-bar.tsx`,
`components/list-page.module.css`, `lib/db/text-filter.ts`, or a list page's
`searchParams` handling (`/files`, `/tutor-codes`). Invariants:

- **List filtering happens in the database, never in memory.** Filter state lives
  in **URL search params**; the server page reads them and passes them to a store
  query that builds a parameterized `WHERE` (text via `containsAny` =
  wildcard-escaped `LIKE`; mssql collation is case-insensitive, so `like`, not
  `ilike`). Use the Drizzle conditional pattern: an `SQL[]` applied with
  `.where(and(...conditions))`.
- Reusable pieces: **`DataList`** (server, column-driven table + empty/no-match +
  pagination seam), **`ListFilterBar`** (client, "Apply" → `router.push` a new
  query), shared chrome in `list-page.module.css`. The action button (top-left)
  and filter controls (top-right) sit in the **same spot** on every list; add a
  new list by writing its store filter + a server page that renders `DataList`.
- Aggregated columns (e.g. tutor-code "Conversations") are a **single** raw-SQL
  aggregate over the filtered set — **never a query per row**.

### Azure SQL, Drizzle & credentials → `docs/database.md`

Read it before touching Mastra storage (`app/mastra/index.ts`), the Drizzle setup
(`lib/db/`), migrations, or `instrumentation.ts`. Invariants:

- Build the SQL connection config via **`buildMssqlConnectionConfig()`** from
  `lib/azure-credential.ts` — the ONE seam every pool (Mastra, Drizzle, e2e)
  shares. It parses `MSSQL_CONNECTION_STRING` and picks the auth mode **from the
  string itself**: a `User ID=...;Password=...` string uses **SQL auth**;
  otherwise it falls back to **passwordless Entra ID** via tedious's
  `token-credential` + **`buildDataStoreCredential()`** (the explicit
  `ChainedTokenCredential(AzureCliCredential, ManagedIdentityCredential)` chain).
  **NEVER `DefaultAzureCredential`** (it would grab the user-sign-in service
  principal from the `AZURE_*` env vars, which is a different tenant), and never
  hand-build the chain or re-implement the parse/override at a call site.
  **`STORAGE_TENANT_ID`** is the database's tenant var for the Entra path
  (separate from the user sign-in `AZURE_TENANT_ID`); it is irrelevant under SQL auth.
- **Policy: prod is ALWAYS passwordless Entra / Managed Identity.** SQL
  `User ID`/`Password` auth is a **dev/test-only** escape hatch for environments
  that can't do Entra (e.g. a remote coding agent / CI box without `az login` or an
  MI) — never put credentials in a **production** `MSSQL_CONNECTION_STRING`. Keep
  BOTH paths in `buildMssqlConnectionConfig()` (don't drop either). A SQL
  user/password string is itself a secret; the test-only
  `MSSQL_SQLAUTH_CONNECTION_STRING` (read solely by `e2e/db-auth.live.spec.ts`)
  must never be set in prod.
- App tables use the `novedu_` prefix, are defined in `lib/db/schema.ts`, and are
  migrated by Drizzle at startup (`npm run db:generate` → commit `drizzle/`).
  **NO foreign keys between `novedu_*` and `mastra_*` tables** — Mastra auto-manages
  its own schema; relationships are by-value only.

### Telemetry (Azure Monitor / App Insights via OpenTelemetry) → `docs/telemetry.md`

Read it before touching `instrumentation.ts`, `lib/telemetry.ts`, the
`@opentelemetry/*` / `@azure/monitor-opentelemetry` deps, or any `recordError` /
`emitEvent` call site. Invariants:

- Telemetry is **OFF unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is set** — that
  string is a **secret**, so it lives in local `.env` + a prod app-setting, **never
  in the repo or CI** (keeps `qa.yml` secret-free). All telemetry goes through the
  **`lib/telemetry.ts`** seam (`initTelemetry` / `recordError` / `emitEvent`);
  `instrumentation.ts` brings telemetry up **before** migrations and routes every
  uncaught server error to `recordError` via the **`onRequestError`** hook.
- **PRIVACY: telemetry carries NO message/prompt/PII content.** HTTP bodies are not
  captured; `emitEvent()` is the one seam where content could leak, so pass it
  **metadata only** (identifiers, counts) — never user text.

### CI / GitHub Actions security → `docs/ci-security.md`

Read it before touching `.github/workflows/`, adding a secret to a workflow, or
wiring real infra into CI. This is a public teaching repo — fork PRs run untrusted
code on our runners. Invariants:

- **`qa.yml` (runs on fork `pull_request`) stays secret-free** — no `secrets.*`,
  `permissions: contents: read`, dummy `env:` values only. Its `e2e` job runs an
  **ephemeral SQL Server container** (non-secret dummy SA password, reached via SQL
  auth) so the DB-backed `@live-db` tests run on PRs without any real credential.
  The secret-bearing workflow is **`docker-publish.yml`**, which runs only on
  `push` to `main` / `workflow_dispatch` (forks cannot trigger it).
- **No REAL credentials on a fork `pull_request`.** The live tag is split:
  `@live-db` (SQL Server, no LLM) runs in CI against the non-secret container;
  `@live-llm` (the SCCH LLM — geo-blocked to Austria) is excluded via
  `npm run test:e2e:ci` (`--grep-invert @live-llm`) and runs local-only. Real Azure
  SQL / SCCH may only run on a trusted trigger (push to `main`, a schedule, or a
  reviewer-gated environment). **Never add `pull_request_target`.**

### Testing strategy → `docs/testing.md`

Read it before adding a test or tagging one `@live`. Invariants:

- **Prefer fast, secret-free unit/component tests** (Vitest `unit` =
  `**/*.unit.test.{ts,tsx}`, `component` = `**/*.browser.test.tsx`). A test is
  `@live` **only** if it genuinely needs the real DB (`@live-db`) or LLM
  (`@live-llm`) — not just because the code path sits behind one. Gate checks
  (which short-circuit before the runtime) and pure-prop rendering belong in fast
  tests, mocking the I/O seams while keeping the security-critical pure module
  (e.g. `lib/thread-token.ts`) REAL.
- Every live test carries **`@live`** plus exactly one of **`@live-db`** (needs a
  SQL Server) or **`@live-llm`** (also needs the SCCH LLM). CI runs hermetic +
  `@live-db` against an **ephemeral SQL Server container** and excludes `@live-llm`
  (`npm run test:e2e:ci` = `--grep-invert @live-llm`); `@live-llm` is local-only
  (SCCH is geo-blocked to Austria). `npm run test:e2e -- --grep @live` is the full
  local smoke.

### Publishing the `@novedu/cli` npm package → `docs/cli-publish.md`

Read it before touching `cli/package.json`, `.github/workflows/publish-cli.yml`,
or cutting a CLI release. Invariants:

- The CLI publishes to npm as **`@novedu/cli`** via **OIDC trusted publishing**
  (`publish-cli.yml`, triggered on a **`cli-v*` tag**) — **NO `NPM_TOKEN`
  secret**. The workflow has `id-token: write` but no `secrets.*` and runs only
  on the tag push, so it keeps the secret-free CI invariant (see
  `docs/ci-security.md`). The npmjs.com trusted-publisher config is pinned to
  this repo + the filename `publish-cli.yml`; renaming the file breaks publishing.
- `cli/package.json` **MUST** keep its `repository` field (with `directory: cli`):
  `npm publish --provenance` rejects a publish with **HTTP 422** if
  `repository.url` doesn't match the building repo.
- Releases are **forward-only** (npm rejects republishing a version) and the
  workflow **fails fast unless the `cli-vX.Y.Z` tag matches `cli/package.json`
  version**. Bump the version via a PR, merge, then push the matching tag.
