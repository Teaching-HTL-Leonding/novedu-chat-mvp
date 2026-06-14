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
`/share-tutor`, `/tutor-codes`, the stats pages (`/tutor-codes/[code]` and
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
  STUDENT chat path uses this token; the TEACHER stats/viewer pages instead gate
  on **code ownership** (`getOwnedTutorCode`, `created_by === session sub`) — a
  teacher reads only their own codes' conversations.
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

### CI / GitHub Actions security → `docs/ci-security.md`

Read it before touching `.github/workflows/`, adding a secret to a workflow, or
wiring real infra into CI. This is a public teaching repo — fork PRs run untrusted
code on our runners. Invariants:

- **`qa.yml` (runs on fork `pull_request`) stays secret-free** — no `secrets.*`,
  `permissions: contents: read`, dummy `env:` values only. The secret-bearing
  workflow is **`docker-publish.yml`**, which runs only on `push` to `main` /
  `workflow_dispatch` (forks cannot trigger it).
- **Live tests never run on a fork `pull_request`.** `@live` tests (real Azure SQL
  / SCCH) are excluded via `npm run test:e2e:ci`; real credentials may only run on
  a trusted trigger (push to `main`, a schedule, or a reviewer-gated environment).
  **Never add `pull_request_target`.**

### Testing strategy → `docs/testing.md`

Read it before adding a test or tagging one `@live`. Invariants:

- **Prefer fast, secret-free unit/component tests** (Vitest `unit` =
  `**/*.unit.test.{ts,tsx}`, `component` = `**/*.browser.test.tsx`). A test is
  `@live` **only** if it genuinely needs the real DB or LLM — not just because the
  code path sits behind one. Gate checks (which short-circuit before the runtime)
  and pure-prop rendering belong in fast tests, mocking the I/O seams while keeping
  the security-critical pure module (e.g. `lib/thread-token.ts`) REAL.
- A single **`@live`** tag is the boundary: CI runs everything else; the `@live`
  set is the local-only pre-push smoke (`npm run test:e2e -- --grep @live`).

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
