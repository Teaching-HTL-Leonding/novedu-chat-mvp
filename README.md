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
| **Next.js 16 app** (`app/`) | App Router UI. `app/page.tsx` renders `TutorChat`, the paste-a-URL → validate → chat flow. |
| **Tutor core** (`lib/tutors/`) | Framework-agnostic pipeline: fetch → parse YAML → Zod schema-validate → consistency-check → assemble with Handlebars. Returns a structured `BuildResult` (never throws). Fragment files can be referenced by absolute `http(s)` URL or by a path **relative** to the tutor YAML, and fragment inputs may declare **defaults**. See [`tutors/README.md`](tutors/README.md) for the authoring guide. |
| **Mastra agents** (`app/mastra/`) | The `tutor` agent resolves its instructions + model per request from the tutor URL and persists each conversation via Mastra `Memory`. Agents are registered in `app/mastra/index.ts`. Memory/storage is **Azure SQL** via `@mastra/mssql`, authenticated with Microsoft Entra ID (`az login` locally, Managed Identity on Azure). |
| **CopilotKit + AG-UI** | The chat UI is CopilotKit (`@copilotkit/react-core/v2`). Mastra agents are served to it through the AG-UI route handler at `app/api/copilotkit/[[...slug]]/route.ts`. |
| **Model endpoint** (`app/mastra/scch.ts`) | A self-hosted, OpenAI-compatible vLLM GPU server ("SCCH"). The tutor's `llm.model` resolves against this endpoint; the API key stays server-side. |
| **Auth** (`auth.ts`, `proxy.ts`) | Auth.js (NextAuth v5) Microsoft Entra ID gate. Any signed-in user is allowed; everyone else is redirected to sign-in. JWT sessions, no DB adapter. |
| **API routes** (`app/api/`) | `validate-tutor` (validate a tutor URL → prompt or structured errors), `copilotkit` (chat runtime), `auth` (sign-in). |

### Request flow

1. User signs in via Microsoft Entra ID (enforced by `proxy.ts`).
2. User pastes a tutor YAML URL → `POST /api/validate-tutor` validates & assembles it.
3. On success the URL drives the chat: it is sent on the `x-tutor-url` header to
   `/api/copilotkit`, where the `tutor` agent reads it from the request context and resolves
   its system prompt and model from the YAML (memoized per URL).

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

# --- Azure SQL (Microsoft SQL Server) — persistent Mastra memory/storage ---
# Standard ADO.NET connection string. Auth is handled by the app via Microsoft Entra
# (your `az login` identity locally, the app's Managed Identity on Azure) — there is NO
# SQL password here. The `Authentication=...` keyword is ignored if present; the app
# always overrides it with Entra auth. Required to chat — the tutor's memory needs a store.
MSSQL_CONNECTION_STRING=Server=tcp:<server>.database.windows.net,1433;Initial Catalog=<database>;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
# Entra tenant of the SQL database, used for the local `az login` credential. SEPARATE
# from AZURE_TENANT_ID above (the user sign-in tenant), because the database lives in a
# different tenant. Optional — if unset, the az credential uses its ambient default tenant.
MSSQL_TENANT_ID=your-sql-database-tenant-id
```

Notes:

- The app **fails fast at startup** if any `AZURE_*` value is missing.
- If `SCCH_BASE_URL` / `SCCH_API_KEY` are unset, the app still starts but no SCCH chat
  models are available (a warning is logged).
- `MSSQL_CONNECTION_STRING` is **required to chat**: the `tutor` agent's memory needs a
  store, so a tutor chat fails with a server error if it is unset (the rest of the app —
  e.g. tutor validation — still boots). When set, the Mastra schema (`mastra_*` tables) is
  created automatically on first use, so the configured Entra identity needs table-creation
  rights (e.g. `db_owner`) the first time.
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
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test` | Vitest (unit + component). |
| `npm run test:e2e` | Playwright end-to-end tests. |
| `npm run qa` | `check` + `typecheck` + `test` + `build`. |

> Use the `dev` / `build` npm scripts rather than invoking `next` or `mastra` directly.

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
  chat — there is no in-memory fallback (a tutor chat errors if it is missing). Per-user
  memory scoping is not yet wired up: threads are persisted under a single hard-coded
  resource id (`chat-prototype`).
- **SSRF** — `/api/validate-tutor` fetches an arbitrary user-supplied URL server-side. The
  prototype only restricts the scheme to `http(s)`; a production deployment should also
  allow-list hosts, block private IP ranges, and disable redirects.
- **Authorization** — any authenticated Entra user is allowed; there is no group/role check.
