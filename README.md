# Chat Prototype

A prototype web app for **YAML-defined AI tutors**. A user pastes the public URL of a
*tutor-definition YAML*; the app fetches, validates and assembles it into a system prompt,
then opens a chat with an LLM that is configured entirely by that YAML — its persona, rules
and model all come from the tutor file, not from the app.

It is a prototype: access is gated behind Microsoft Entra ID sign-in, and agent
memory/storage is persisted to Azure SQL (authenticated via Entra — no SQL password).

## What's in here

| Area | Description |
| --- | --- |
| **Next.js 16 app** (`app/`) | App Router UI. `app/page.tsx` is the tutor-code entry page; `app/[code]/page.tsx` checks the code and renders `TutorChat`. Teachers create and list codes under `/share-tutor` and `/tutor-codes`. |
| **Tutor core** (`lib/tutors/`) | Framework-agnostic pipeline: fetch → parse YAML → Zod schema-validate → consistency-check → assemble with Handlebars. Returns a structured `BuildResult` (never throws). Fragment files can be referenced by absolute `http(s)` URL or by a path **relative** to the tutor YAML, and fragment inputs may declare **defaults**. See [`tutors/README.md`](tutors/README.md) for the authoring guide. |
| **Mastra agents** (`app/mastra/`) | The `tutor` agent resolves its instructions + model per request from the tutor URL and persists each conversation via Mastra `Memory`. Agents are registered in `app/mastra/index.ts`. Memory/storage is **Azure SQL** via `@mastra/mssql`, authenticated with Microsoft Entra ID (`az login` locally, Managed Identity on Azure). |
| **CopilotKit + AG-UI** | The chat UI is CopilotKit (`@copilotkit/react-core/v2`). Mastra agents are served to it through the AG-UI route handler at `app/api/copilotkit/[[...slug]]/route.ts`. |
| **Model endpoint** (`app/mastra/scch.ts`) | A self-hosted, OpenAI-compatible vLLM GPU server ("SCCH"). The tutor's `llm.model` resolves against this endpoint; the API key stays server-side. |
| **Auth** (`auth.ts`, `proxy.ts`) | Auth.js (NextAuth v5) Microsoft Entra ID gate. Any signed-in user passes the gate (everyone else is redirected to sign-in); teacher-only operations are separately gated by `TEACHER_GROUP_ID` membership (`session.user.isTeacher`). JWT sessions, no DB adapter. |
| **API routes** (`app/api/`) | `validate-tutor` (validate a tutor URL → prompt or structured errors), `copilotkit` (chat runtime), `auth` (sign-in). |

### Request flow

1. User signs in via Microsoft Entra ID (enforced by `proxy.ts`).
2. A teacher creates a **Tutor Code** on `/share-tutor` (tutor YAML URL + availability
   window + note, stored in the `novedu_tutor_codes` SQL table) and hands out
   `https://<host>/<code>`.
3. A student opens `/<code>` (or types the code on `/`); the server checks the stored
   row + window, validates & assembles the tutor YAML, and renders the chat.
4. The chat sends the code on the `x-tutor-code` header to `/api/copilotkit`, which
   re-checks it on every request, hands the stored tutor URL to the `tutor` agent
   (system prompt + model resolved from the YAML, memoized per URL), and scopes
   Mastra memory by the code (`resourceId`). See `docs/tutor-codes.md`.

## Prerequisites

- **Node.js 24+** (developed against v24.15).
- A reachable **OpenAI-compatible model endpoint** (the SCCH vLLM server) for tutor chats.
- A **Microsoft Entra ID app registration** for sign-in.
- An **Azure SQL database** for persistent agent memory/storage, with your Entra
  identity granted a database user (the app authenticates via Entra — no SQL password).
  Locally that identity is your `az login`; on Azure it is the app's Managed Identity.

## Configuration (`.env`)

Create a `.env` file in the project root with the following keys. **None of these are
exposed to the browser** — they are read only in server-side modules.

```bash
# --- Self-hosted vLLM (OpenAI-compatible) endpoint that serves tutor chat models ---
SCCH_BASE_URL=https://your-vllm-host/v1
SCCH_API_KEY=your-vllm-api-key

# --- Microsoft Entra ID sign-in (Auth.js / NextAuth v5) ---
AZURE_TENANT_ID=your-entra-tenant-id
AZURE_CLIENT_ID=your-entra-app-client-id
AZURE_CLIENT_SECRET=your-entra-app-client-secret

# Secret used by Auth.js to sign JWT session tokens. Generate one with:
#   openssl rand -base64 32
AUTH_SECRET=your-generated-secret

# Object id of the Entra security group whose members are treated as teachers
# (gates teacher-only operations such as creating tutor codes). Tenant-specific
# configuration, not a secret. Required — the app fails to start without it.
TEACHER_GROUP_ID=your-entra-teacher-group-object-id

# --- Azure SQL (Microsoft SQL Server) — Mastra memory + app tables (tutor codes) ---
# Standard ADO.NET connection string. Auth is handled by the app via Microsoft Entra
# (your `az login` identity locally, the app's Managed Identity on Azure) — there is NO
# SQL password here. The `Authentication=...` keyword is ignored if present; the app
# always overrides it with Entra auth. Required to chat — tutor codes and the tutor's
# memory live in this database.
MSSQL_CONNECTION_STRING=Server=tcp:<server>.database.windows.net,1433;Initial Catalog=<database>;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
# Entra tenant of the SQL database, used for the local `az login` credential.
# SEPARATE from AZURE_TENANT_ID above (the user sign-in tenant), because the database
# lives in a different tenant. Optional — if unset, the az credential uses its
# ambient default tenant.
STORAGE_TENANT_ID=your-data-store-tenant-id

# --- Tutor codes ---
# Public origin the generated chat URLs (`https://<origin>/<tutor-code>`) point at,
# e.g. https://novedu.example.org
# RECOMMENDED IN PRODUCTION: without it the origin is derived from the request's
# x-forwarded-host/-proto headers, which is only as reliable as the proxy chain
# (and falls back to http://). Optional for local dev (localhost works). Display-only:
# a tutor code works on ANY origin that talks to the same database.
TUTOR_CODE_ORIGIN=https://your-public-origin
```

Notes:

- The app **fails fast at startup** if any required sign-in variable is missing — the
  `AZURE_*` Entra credentials and `TEACHER_GROUP_ID` (`auth.ts`). (`AUTH_SECRET` is
  likewise enforced by Auth.js itself.)
- If `SCCH_BASE_URL` / `SCCH_API_KEY` are unset, the app still starts but no SCCH chat
  models are available (a warning is logged).
- `MSSQL_CONNECTION_STRING` is **required to chat**: tutor codes and the `tutor`
  agent's memory live in the database, so creating/opening a tutor chat fails if it is
  unset (the rest of the app — e.g. tutor validation — still boots). When set, the
  Mastra schema (`mastra_*` tables) is created automatically on first use and the
  app's own `novedu_*` tables are migrated by Drizzle at startup
  (`instrumentation.ts`), so the configured Entra identity needs table-creation
  rights (e.g. `db_owner`).
- Schema changes to the `novedu_*` tables: edit `lib/db/schema.ts`, run
  `npm run db:generate`, and commit the generated migration in `drizzle/`.
- Expired tutor codes are garbage-collected by an hourly in-process task started at
  server startup.
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

Then open **http://localhost:3000**, sign in with Microsoft Entra ID, paste a tutor YAML URL
(see `tutors/` for samples), and start chatting.

### Production build

```bash
npm run build
npm run start
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` / `npm run start` | Production build / serve. |
| `npm run check` | Biome lint + format check. (`check:fix` to auto-fix.) |
| `npm run lint` / `npm run format` | Biome lint only / format-write only. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test` | Vitest (unit + component). (`test:unit` / `test:component` for one project.) |
| `npm run test:e2e` | Playwright end-to-end tests. (`test:e2e:ci` skips `@live` tests needing real infra.) |
| `npm run db:generate` | Generate a Drizzle migration after editing `lib/db/schema.ts` (commit the result in `drizzle/`). |
| `npm run qa` | `check` + `typecheck` + `test` + `build`. (`qa:e2e` adds the e2e suite.) |

> Use the `dev` / `build` npm scripts rather than invoking `next` or `mastra` directly.

> Testing layers, the `@live` boundary, and the patterns for testing the chat gate
> without a database or LLM are documented in [`docs/testing.md`](docs/testing.md).

## Tutors

The `tutors/` directory contains sample tutor and fragment YAML files, and
[`tutors/README.md`](tutors/README.md) documents the full authoring format — fragments,
priorities, `input_schema`, variable binding, relative fragment URLs, and optional inputs
with defaults.

## Notes & caveats (prototype)

- **Storage** — Mastra memory/storage is persisted to Azure SQL (`@mastra/mssql`) using
  Microsoft Entra auth (`token-credential` + an explicit `az login`/Managed Identity
  credential chain; tokens are fetched and auto-refreshed per pooled connection). The
  `tutor` agent's memory requires this store, so `MSSQL_CONNECTION_STRING` must be set to
  chat — there is no in-memory fallback (a tutor chat errors if it is missing). Memory is
  scoped by **tutor code**: the code is the Mastra `resourceId`, so every thread is grouped
  under its code. A user↔chat link is written to `novedu_user_chats` **only** for tutors
  that opt out of anonymity (`anonymous: false`); the default is anonymous and stores no
  link. See `docs/tutor-codes.md`.
- **SSRF** — `/api/validate-tutor` fetches an arbitrary user-supplied URL server-side. The
  prototype only restricts the scheme to `http(s)`; a production deployment should also
  allow-list hosts, block private IP ranges, and disable redirects.
- **Authorization** — the Entra gate admits any signed-in user, but teacher-only operations
  (creating/listing tutor codes, validating tutors) are gated by membership in
  `TEACHER_GROUP_ID`, surfaced as `session.user.isTeacher` and enforced server-side via
  `requireEffectiveTeacher()` (`lib/student-mode.ts`, which also honors "view as student"
  mode). See `docs/auth.md`.
