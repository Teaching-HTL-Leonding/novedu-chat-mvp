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

### Tutor share links & short URLs → `docs/share-links.md`

Read it before touching the chat entry point (`app/page.tsx`), `/share-tutor`, or link
verification. Invariants:

- The chat (`/`) is reachable **only** via a teacher's signed deep link
  (`/?tutor=…&start=…&end=…&sig=…`) or its stored short form `/?link=<code>`.
- The HMAC signature is the security boundary, and it is verified server-side in **BOTH**
  `app/page.tsx` and the CopilotKit route (`app/api/copilotkit/[[...slug]]/route.ts`) —
  keep both in sync. A short code is just an index lookup; the resolved values still go
  through the same `verifyShareLink`.

### Azure storage (SQL + Table) & credentials → `docs/azure-storage.md`

Read it before touching Mastra storage (`app/mastra/index.ts`) or the share-link table
(`lib/share-link-store.ts`). Invariants:

- Authenticate via **`buildDataStoreCredential()`** from `lib/azure-credential.ts`
  (the explicit `ChainedTokenCredential(AzureCliCredential, ManagedIdentityCredential)`
  chain) — **NEVER `DefaultAzureCredential`** (it would grab the user-sign-in service
  principal from the `AZURE_*` env vars, which is a different tenant), and never
  hand-build the chain at a call site.
- The storage account has shared-key access **DISABLED** (Entra-only; `az storage`
  data-plane commands need `--auth-mode login`). **`STORAGE_TENANT_ID`** is the single
  tenant var shared by the SQL DB and the storage account (separate from the user
  sign-in `AZURE_TENANT_ID`).
