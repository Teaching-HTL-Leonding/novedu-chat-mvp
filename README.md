# Chat Prototype

A prototype web app for **YAML-defined AI learning activities**. A teacher authors an
activity as YAML (hosted on a public URL or in-app), mints a short **code** for it, and
hands out `https://<host>/<code>`; a student opens the code and the app renders the right
experience for that activity's **module**. The activity — persona, rules, model, questions,
prompt — comes from the YAML, not from the app.

Four modules share one generic "codes" pipeline (access, storage, attribution):

- **tutor** — a chat with an LLM configured entirely by a *tutor-definition YAML*.
- **quiz** — LLM-graded open-ended questions, with an opt-in follow-up discussion chat; questions can let students answer with photos (`imageInput`, e.g. handwritten work). The grader is server-only.
- **writing** — a split-screen Markdown editor where an AI assistant gives feedback (it can *read* the draft but never edit it) and the student saves their text.
- **coding** — an OpenAI-compatible Chat Completions endpoint an external coding agent (e.g. little-coder) points at; the code is the bearer API key, and the teacher's system prompt + model are injected server-side.

All four kinds share **prompt fragments** — reusable, parameterized system-prompt pieces (persona, safety, ground rules) assembled from **fragment libraries**. Written once, they are pulled into any activity and prepended to its instructions (for a quiz, to both the grader and the discussion chat). See [`docs/prompt-fragments.md`](docs/prompt-fragments.md).

It is a prototype: access is gated behind Microsoft Entra ID sign-in (the teacher
guide at `/docs` is deliberately public), and agent memory/storage is persisted to
Azure SQL (authenticated via Entra — no SQL password).

## What's in here

| Area | Description |
| --- | --- |
| **Next.js 16 app** (`app/`) | App Router UI. `app/page.tsx` is the code-entry page; `app/[code]/page.tsx` checks the code and **dispatches by its `module`** to the tutor/quiz/writing/coding renderer. Teachers create, list, and edit **codes** under `/codes` (new at `/codes/new`, edit at `/codes/edit/<code>`), author **app-hosted YAML files** under `/files` and **images** under `/images`, and see usage on the `/usage` dashboard. See [`docs/codes.md`](docs/codes.md). Lists filter in the DB — see [`docs/filtered-lists.md`](docs/filtered-lists.md). |
| **Prompt-fragment core** (`lib/prompt-fragments/`) | The shared, framework-agnostic pipeline every activity kind builds on: fetch → parse YAML → Zod schema-validate → consistency-check → assemble with Handlebars. `assembleFragmentPrompt` resolves a document-level fragment block into a prompt string (a structured result, never throws); tutor, quiz, writing, and coding all call it. Handlebars is confined to this module (grep-guard enforced). Fragment files can be referenced by absolute `http(s)` URL or by a path **relative** to the activity YAML, and fragment inputs may declare **defaults**. See [`docs/prompt-fragments.md`](docs/prompt-fragments.md) and [`activities/tutors/README.md`](activities/tutors/README.md) (the authoring guide). |
| **Mastra agents** (`app/mastra/`) | The `tutor`, `quizDiscussion`, and `writing` agents resolve their instructions + model per request and persist conversations via Mastra `Memory`; the server-only `quizEvaluator` grader is never web-reachable. Agents are registered in `app/mastra/index.ts`. Storage is **Azure SQL** via `@mastra/mssql`, authenticated with Microsoft Entra ID (`az login` locally, Managed Identity on Azure). (The `coding` module has **no** Mastra agent — it is a thin proxy.) |
| **CopilotKit + AG-UI** | The chat UI is CopilotKit (`@copilotkit/react-core/v2`). Mastra agents are served to it through the AG-UI route handler at `app/api/copilotkit/[[...slug]]/route.ts`. See [`docs/chat.md`](docs/chat.md). |
| **Coding proxy** (`app/api/coding/**`, `lib/coding-proxy.ts`) | A **public**, OpenAI-compatible `POST /api/coding/v1/chat/completions` that authenticates with the code as the bearer key, appends the teacher's system prompt, pins the model, and streams SCCH's response straight back. See [`docs/coding.md`](docs/coding.md). |
| **Images** (`app/images/**`, `lib/image-*.ts`) | Teacher-uploaded images stored in Azure Blob Storage, addressed by passwordless **User-Delegation SAS** (account keys disabled); retrieval is direct-to-blob (no app route serves the bytes). See [`docs/images.md`](docs/images.md). |
| **Usage metering** (`lib/usage-store.ts`, `app/mastra/usage-exporter.ts`) | Per-hour token / tool-call / activity counts written off the response path into two anonymity-preserving tables (`novedu_usage_by_code`, `novedu_usage_by_user`), surfaced on the teacher `/usage` dashboard. See [`docs/usage-metering.md`](docs/usage-metering.md) and [`docs/dashboard.md`](docs/dashboard.md). |
| **LLM providers** (`lib/llm/`, `app/mastra/scch.ts`, `lib/scch-endpoint.ts`) | Two OpenAI-compatible upstreams behind one server-only seam: a self-hosted vLLM GPU server ("SCCH", the default) and — optionally, when `AZURE_FOUNDRY_ENDPOINT` is set — **Azure Foundry** (passwordless Entra auth, no API key). The activity YAML's `llm:` block picks provider + model, and a code can override the pair; endpoints, keys, and tokens stay server-side. See [`docs/ai-models.md`](docs/ai-models.md). |
| **Auth** (`auth.ts`, `proxy.ts`, `lib/api-auth.ts`) | Auth.js (NextAuth v5) Microsoft Entra ID gate (Next 16 renamed `middleware` → `proxy.ts`). Any signed-in user passes the gate; teacher-only operations are gated by `TEACHER_GROUP_ID` membership (`session.user.isTeacher`), enforced server-side via `requireEffectiveTeacher()` (which honors "view as student" mode). JWT sessions, no DB adapter. See [`docs/auth.md`](docs/auth.md). A second, cookie-free channel serves CLI/API clients: Entra **bearer tokens** (the CLI is a public client of the same app registration), validated on every request by `lib/api-auth.ts` (`requireBearerUser` / `requireBearerTeacher`; no student mode on this channel). See [`docs/api.md`](docs/api.md). |
| **Teacher docs** (`teacher-docs/`, `teacher-docs-site/`) | The teacher-facing guide as a **generated Markdown corpus** (`teacher-docs/` — chapters are regenerated from human-owned prompts via the `novedu-teacher-docs` skill, never hand-edited) and an **Astro Starlight site** that renders it (`teacher-docs-site/`, an npm workspace). Served **publicly at `/docs`** inside this app — built into `public/docs/` by the Docker image build, deliberately excluded from the Entra gate. `npm run docs:dev` for local authoring; the corpus-contract test + site build are the consistency checks. See [`docs/teacher-docs.md`](docs/teacher-docs.md). |
| **API routes** (`app/api/`) | `copilotkit` (chat runtime), `coding/v1/chat/completions` (**public** OpenAI-compatible endpoint), `files/<name>` (**public** GET: serve an app-hosted YAML file as raw text; **bearer** PUT: upsert for `novedu-cli files upload`), `files` + `codes` (**bearer**, teacher-only: list/create for the CLI — see [`docs/api.md`](docs/api.md)), `auth` (sign-in), `me` (**bearer-token** identity probe backing `novedu-cli whoami`), `version` (public build-identity probe), `health` (teacher-gated probe). |

### Request flow

1. User signs in via Microsoft Entra ID (enforced by `proxy.ts`).
2. A teacher creates a **Code** on `/codes/new` (module + activity YAML + availability
   window + note, stored in the `novedu_codes` SQL table) and hands out
   `https://<host>/<code>`.
3. A student opens `/<code>` (or types the code on `/`); the server checks the stored
   row + window and renders the experience for the code's `module` (tutor chat, quiz
   runner, writing editor, or the coding connection details).
4. In-app chat (tutor / quiz discussion / writing) sends the code on the **`x-code`**
   header to `/api/copilotkit`, which re-checks it on every request, dispatches to the
   module's agent, and scopes Mastra memory by the code (`resourceId`). A per-student
   **`x-thread-token`** HMAC binds each thread to its owner. See [`docs/codes.md`](docs/codes.md).
5. The **coding** module has no in-app chat: an external agent calls
   `POST /api/coding/v1/chat/completions` with the code as its bearer API key. See
   [`docs/coding.md`](docs/coding.md).

## Prerequisites

- **Node.js 24+** (developed against v24.15).
- A reachable **OpenAI-compatible model endpoint** (the SCCH vLLM server) for activity chats.
  **Optional:** an **Azure Foundry** resource as a second provider (passwordless Entra —
  see [`docs/ai-models.md`](docs/ai-models.md)).
- A **Microsoft Entra ID app registration** for sign-in.
- An **Azure SQL database** for persistent agent memory/storage, with your Entra
  identity granted a database user (the app authenticates via Entra — no SQL password).
  Locally that identity is your `az login`; on Azure it is the app's Managed Identity.
  (A SQL `User ID`/`Password` login also works as a **dev/test-only** fallback for
  environments without Entra — see [Storage](#notes--caveats-prototype) below — but
  **production always uses passwordless Entra**.)
- **Optional:** an **Azure Blob Storage** account (account keys disabled; passwordless
  User-Delegation SAS) for the image subsystem.

## Configuration (`.env`)

Create a `.env` file in the project root with the following keys. **None of these are
exposed to the browser** — they are read only in server-side modules.

```bash
# --- Self-hosted vLLM (OpenAI-compatible) endpoint that serves activity chat models ---
SCCH_BASE_URL=https://your-vllm-host/v1
SCCH_API_KEY=your-vllm-api-key

# --- Azure Foundry (optional) — second LLM provider ---
# Bare resource endpoint of an Azure OpenAI / Foundry resource. Unset => the app
# runs SCCH-only (Foundry activities are rejected at authoring time and guarded at
# runtime). Auth is passwordless Entra — your `az login` identity locally, the
# Managed Identity on Azure; there is NO API key. See docs/ai-models.md.
AZURE_FOUNDRY_ENDPOINT=https://your-foundry-resource.cognitiveservices.azure.com

# --- Microsoft Entra ID sign-in (Auth.js / NextAuth v5) ---
AZURE_TENANT_ID=your-entra-tenant-id
AZURE_CLIENT_ID=your-entra-app-client-id
AZURE_CLIENT_SECRET=your-entra-app-client-secret

# Secret used by Auth.js to sign JWT session tokens. Generate one with:
#   openssl rand -base64 32
AUTH_SECRET=your-generated-secret

# Object id of the Entra security group whose members are treated as teachers
# (gates teacher-only operations such as creating codes). Tenant-specific
# configuration, not a secret. Required — the app fails to start without it.
TEACHER_GROUP_ID=your-entra-teacher-group-object-id

# --- Azure SQL (Microsoft SQL Server) — Mastra memory + app tables (novedu_*) ---
# Standard ADO.NET connection string. Required to chat — codes and the agents'
# memory live in this database. The app picks the auth mode from the string itself:
#   * Omit user/password to use passwordless Microsoft Entra auth (your `az login`
#     identity locally, the app's Managed Identity on Azure). The `Authentication=...`
#     keyword is ignored; Entra is wired up in code. ← USE THIS IN PRODUCTION.
#   * Include `User ID=...;Password=...` for classic SQL Server auth — a DEV/TEST-ONLY
#     fallback for environments that can't do Entra (e.g. a remote coding agent / CI
#     box). NEVER use a SQL password in a production connection string.
MSSQL_CONNECTION_STRING=Server=tcp:<server>.database.windows.net,1433;Initial Catalog=<database>;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
# Entra tenant of the SQL database, used for the local `az login` credential. Only
# relevant on the Entra path (ignored when the connection string carries a SQL
# user/password). SEPARATE from AZURE_TENANT_ID above (the user sign-in tenant),
# because the database lives in a different tenant. Optional — if unset, the az
# credential uses its ambient default tenant.
STORAGE_TENANT_ID=your-data-store-tenant-id
# OPTIONAL, local-only — a SECOND connection string to the SAME database that uses a
# SQL `User ID=...;Password=...` login instead of Entra. Used ONLY by the `@live`
# DB-auth test (e2e/db-auth.live.spec.ts), which SKIPS when this is unset. Keep it out
# of CI/the repo. See docs/testing.md for how to provision the SQL login.
MSSQL_SQLAUTH_CONNECTION_STRING=Server=tcp:<server>.database.windows.net,1433;Initial Catalog=<database>;Encrypt=True;User ID=<sql-login>;Password=<password>;

# --- Public origin ---
# Public origin the generated code URLs (`https://<origin>/<code>`) and the coding
# endpoint's connection snippet point at, e.g. https://novedu.example.org
# RECOMMENDED IN PRODUCTION: without it the origin is derived from the request's
# x-forwarded-host/-proto headers, which is only as reliable as the proxy chain
# (and falls back to http://). Optional for local dev (localhost works). Display-only:
# a code works on ANY origin that talks to the same database.
# (The legacy name TUTOR_CODE_ORIGIN is still read as a fallback.)
CODE_ORIGIN=https://your-public-origin

# --- Images (optional) — Azure Blob Storage for teacher-uploaded images ---
# The storage account name and container. Both are OPTIONAL and default to the
# hosted prototype's values (stnoveduchatmvp / novedu-images). Bytes are addressed
# by passwordless User-Delegation SAS (account keys disabled), reached with the same
# data-store credential as the database. See docs/images.md.
IMAGE_STORAGE_ACCOUNT=your-storage-account-name
IMAGE_BLOB_CONTAINER=your-container-name

# --- Telemetry (optional) — Azure Monitor / Application Insights via OpenTelemetry ---
# Unset => telemetry is fully OFF (no exporter, no network sink). When set, server
# traces/metrics/logs/exceptions export to App Insights. This is a SECRET — keep it
# out of the repo and CI (see docs/telemetry.md). NO message/prompt/PII content is
# ever sent.
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
# Sets the App Insights cloud_RoleName so the app's spans are attributable.
OTEL_SERVICE_NAME=novedu-chat
```

Notes:

- The app **fails fast at startup** if any required sign-in variable is missing — the
  `AZURE_*` Entra credentials and `TEACHER_GROUP_ID` (`auth.ts`). (`AUTH_SECRET` is
  likewise enforced by Auth.js itself.)
- If `SCCH_BASE_URL` / `SCCH_API_KEY` are unset, the app still starts but no SCCH chat
  models are available (a warning is logged).
- `APPLICATIONINSIGHTS_CONNECTION_STRING` is **optional**: unset means telemetry is
  fully off. When set, server telemetry exports to Azure Monitor / App Insights — no
  conversation content is ever sent. See `docs/telemetry.md`.
- `MSSQL_CONNECTION_STRING` is **required to chat**: codes and the agents' memory live
  in the database, so creating/opening an activity fails if it is unset (the rest of the
  app still boots; activity validation without the app is the CLI's `validate` command). When set, the Mastra schema (`mastra_*`
  tables) is created automatically on first use and the app's own `novedu_*` tables are
  migrated by Drizzle at startup (`instrumentation.ts`), so the configured SQL login or
  Entra identity needs table-creation rights (e.g. `db_owner`).
- Schema changes to the `novedu_*` tables: edit `lib/db/schema.ts`, run
  `npm run db:generate`, and commit the generated migration in `drizzle/`.
- Codes are **not** garbage-collected: a code and all of its conversation data persist
  until a teacher deletes it on `/codes`. An expired code stays listed (its activity no
  longer opens, but its stats remain reachable). See `docs/codes.md`.
- In your Entra app registration, add the redirect URI
  `http://localhost:3000/api/auth/callback/microsoft-entra-id` (and the equivalent for any
  deployed origin).

## Running the app

```bash
# 1. Install dependencies
npm install

# 2. Create .env (see Configuration above)

# 3. Start the dev server
npm run dev
```

Then open **http://localhost:3000**, sign in with Microsoft Entra ID, and — as a teacher —
create a code on `/codes/new` (see `activities/` for samples).

### Production build

```bash
npm run build
npm run start
```

To serve the teacher guide at `/docs` locally too, run `npm run docs:stage` first —
it builds the docs site into `public/docs/`. (The Docker image build does this
automatically; a plain local build without staging simply 404s on `/docs`.)

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` / `npm run start` | Production build / serve. |
| `npm run check` | Biome lint + format check. (`check:fix` to auto-fix.) |
| `npm run lint` / `npm run format` | Biome lint only / format-write only. |
| `npm run typecheck` | All three workspaces: `tsc --noEmit` (app) + `tsc -p cli` + `astro check` (docs site). |
| `npm run test` | Vitest (unit + component). (`test:unit` / `test:component` for one project.) |
| `npm run test:e2e` | Playwright end-to-end tests (all specs, incl. `@live`). |
| `npm run test:e2e:ci` | Hermetic + `@live-db` (against a SQL container); skips `@live-llm` and `@live-storage`. (`test:e2e:db` / `test:e2e:storage` run one live group.) |
| `npm run db:generate` | Generate a Drizzle migration after editing `lib/db/schema.ts` (commit the result in `drizzle/`). |
| `npm run qa` | `check` + `typecheck` + `test` + `build` + `docs:build`. (`qa:e2e` adds the e2e suite.) |
| `npm run docs:dev` | Serve the teacher guide locally at `:4321/docs/` (Astro Starlight; `docs:build` / `docs:preview` for the static build, `docs:stage` to stage it into `public/docs` so the app serves `/docs` locally). |
| `npm run cli` | Run the `@novedu/cli` companion CLI (workspace under `cli/`): `validate` activity YAML, `login` / `logout` / `whoami` for Entra ID sign-in, and the teacher management commands `codes create/list` + `files upload/list` (JSON in/out) against the app's bearer-protected APIs. |

> Use the `dev` / `build` npm scripts rather than invoking `next` or `mastra` directly.

> Testing layers, the `@live-db` / `@live-llm` / `@live-storage` split (and how DB-backed
> live tests run in CI against a SQL Server container), and the patterns for testing the
> chat gate without a database or LLM are documented in [`docs/testing.md`](docs/testing.md).

## Activities

The `activities/` directory contains sample YAML for each module — `tutors/`, `quizzes/`,
`writings/`, and `coding/` — each with its own `README.md` authoring guide (see also
[`activities/README.md`](activities/README.md)). The `@novedu/cli` package (`cli/`) validates
an activity file with the exact checks the app enforces, signs in with Entra ID
(`login` / `logout` / `whoami`), and lets teachers manage the app over its
bearer-protected APIs — `codes create/list` and `files upload/list`, JSON in/out
(`npm run cli` locally; published as `@novedu/cli` — see [`docs/api.md`](docs/api.md)).

## Related projects

This repository is the **server side** of Novedu — where teachers author activities and
students connect. A companion repository provisions the **student coding environments**
that consume the [`coding`](docs/coding.md) module:

- **[`novedu-dev-venv-generator`](https://github.com/Teaching-HTL-Leonding/novedu-dev-venv-generator)**
  (`vcoding-env`) — one idempotent `deploy.sh` spins up *N* disposable, browser-based Azure
  VMs, each running [code-server](https://github.com/coder/code-server) (VS Code in the
  browser) plus the [pi.dev](https://pi.dev) coding agent. The agent is pre-wired to this
  app's coding endpoint (`POST /api/coding/v1/chat/completions`) with the activity **Code**
  as its bearer API key, so a student's in-browser agent codes against the teacher's chosen
  model and system prompt — no local setup.

**Typical workflow:** a teacher creates a `coding` **Code** here (`/codes/new`), then runs
`./deploy.sh <CODE>` in the generator to hand each student a ready-to-hack browser IDE whose
coding agent talks back to this activity. The two repos are the server and client halves of
the same coding-workshop flow.

## Documentation

Per-subsystem deep references live in [`docs/`](docs/): codes & modules
([`codes.md`](docs/codes.md)), the shared [`prompt-fragments.md`](docs/prompt-fragments.md),
[`writing.md`](docs/writing.md), [`coding.md`](docs/coding.md),
the chat surface ([`chat.md`](docs/chat.md)), app-hosted [`files.md`](docs/files.md) and
[`images.md`](docs/images.md), usage [`usage-metering.md`](docs/usage-metering.md) +
[`dashboard.md`](docs/dashboard.md), [`auth.md`](docs/auth.md), the CLI/API bearer
channel ([`api.md`](docs/api.md)), LLM providers ([`ai-models.md`](docs/ai-models.md)),
[`database.md`](docs/database.md), [`telemetry.md`](docs/telemetry.md),
[`testing.md`](docs/testing.md), [`filtered-lists.md`](docs/filtered-lists.md), and the
teacher guide corpus + docs site ([`teacher-docs.md`](docs/teacher-docs.md)).
`AGENTS.md` is the slim router that ties them together.

## Notes & caveats (prototype)

- **Storage** — Mastra memory/storage is persisted to Azure SQL (`@mastra/mssql`). The
  connection string drives the auth mode: classic SQL user/password when the string
  carries `User ID`/`Password`, otherwise passwordless Microsoft Entra auth
  (`token-credential` + an explicit `az login`/Managed Identity credential chain;
  tokens are fetched and auto-refreshed per pooled connection). **When to use which:**
  production is **always** passwordless Entra (no secret in the connection string);
  SQL user/password is a **dev/test-only** fallback for environments that can't do
  Entra (e.g. a remote coding agent or CI box without `az login` / a Managed Identity).
  Never put a SQL password in a production `MSSQL_CONNECTION_STRING`. The chat agents'
  memory requires this store, so `MSSQL_CONNECTION_STRING` must be set to chat — there is
  no in-memory fallback. Memory is scoped by **code**: the code is the Mastra
  `resourceId`, so every thread is grouped under it. A user↔chat link is written to
  `novedu_user_chats` **only** for activities that opt out of anonymity
  (`anonymous: false`); the default is module-specific (tutor/quiz default anonymous,
  writing does not). See `docs/codes.md`.
- **Anonymity & metering** — usage is metered into two independent hourly tables that
  never link a user to a code (`usage_by_code` has no user, `usage_by_user` has no code),
  so the anonymity invariant holds even though the runtime knows the `oid`. See
  `docs/usage-metering.md`.
- **SSRF** — validating an activity (saving a file, minting a code) fetches
  teacher-supplied URLs server-side. The prototype only restricts the scheme to
  `http(s)`; a production deployment should also allow-list hosts, block private IP
  ranges, and disable redirects.
- **Authorization** — the Entra gate admits any signed-in user, but teacher-only
  operations (creating/listing codes, authoring files/images, the
  usage dashboard) are gated by membership in `TEACHER_GROUP_ID`, surfaced as
  `session.user.isTeacher` and enforced server-side via `requireEffectiveTeacher()`
  (`lib/student-mode.ts`, which also honors "view as student" mode). The public coding
  endpoint instead authenticates with the code as its bearer key, and the static
  teacher guide under `/docs` is public by intent (no handler, plain files — see
  `docs/teacher-docs.md`). See `docs/auth.md`.
