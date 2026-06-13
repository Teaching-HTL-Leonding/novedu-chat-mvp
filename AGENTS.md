<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

### Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly

### Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)

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
`/share-tutor`, `/tutor-codes`, the chat runtime route, or the `novedu_*` stores in
`lib/`. Invariants:

- The chat is reachable **only** via `/<tutor-code>` (10-char `[a-z0-9]` code). The
  stored `novedu_tutor_codes` row gates ACCESS, and `checkTutorCode()` is enforced
  server-side in **BOTH** `app/[code]/page.tsx` and the CopilotKit route
  (`app/api/copilotkit/[[...slug]]/route.ts`, header `x-tutor-code`, re-checked on
  every request) — keep both in sync.
- Thread ISOLATION is the `x-thread-token` ownership token (`lib/thread-token.ts`):
  `app/[code]/page.tsx` generates the thread id and signs `(code, userId, threadId)`;
  the CopilotKit route verifies it on every thread-touching request and 404s all
  runtime endpoints the app does not use. Mastra does NOT bind threads to a
  resource — without the token any code-holder could read others' chats.
- Mastra memory `resourceId` = the tutor code. `novedu_user_chats` is the ONLY
  user↔chat link and is written **only** for tutors with `anonymous: false` in their
  YAML (default: anonymous, nothing stored) — that promise is why thread ownership
  is a stateless HMAC, not a table.

### Azure SQL, Drizzle & credentials → `docs/database.md`

Read it before touching Mastra storage (`app/mastra/index.ts`), the Drizzle setup
(`lib/db/`), migrations, or `instrumentation.ts`. Invariants:

- Authenticate via **`buildDataStoreCredential()`** from `lib/azure-credential.ts`
  (the explicit `ChainedTokenCredential(AzureCliCredential, ManagedIdentityCredential)`
  chain) — **NEVER `DefaultAzureCredential`** (it would grab the user-sign-in service
  principal from the `AZURE_*` env vars, which is a different tenant), and never
  hand-build the chain at a call site. **`STORAGE_TENANT_ID`** is the database's
  tenant var (separate from the user sign-in `AZURE_TENANT_ID`).
- App tables use the `novedu_` prefix, are defined in `lib/db/schema.ts`, and are
  migrated by Drizzle at startup (`npm run db:generate` → commit `drizzle/`).
  **NO foreign keys between `novedu_*` and `mastra_*` tables** — Mastra auto-manages
  its own schema; relationships are by-value only.
