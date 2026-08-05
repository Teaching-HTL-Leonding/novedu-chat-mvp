<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Global rules

- Do **not** push to GitHub unless the user explicitly asks.
- `CLAUDE.md` is a symlink to **`AGENTS.md`** — edit `AGENTS.md`.
- Load the **`mastra`** skill before any Mastra work; never rely on cached APIs. Register every agent/tool/workflow/scorer in `app/mastra/index.ts`, and use the `dev`/`build` package scripts, not raw `mastra dev` / `mastra build`.
- Research the [Drizzle docs](https://orm.drizzle.team/llms.txt) before complex queries, transactions, or migrations.
- Research current **Tailwind** docs in context7 (`ctx7` CLI) before styling work — v4 is CSS-first and differs from training data.
- Research current **Recharts** docs in context7 (`/recharts/recharts`) before charting / usage-dashboard work.

## Security & privacy invariants

The highest-cost rules to break. They always apply, regardless of which subsystem you are in. Each links to the doc with the full mechanics.

- Gate teacher-only server actions / route handlers with **`requireEffectiveTeacher()`** (or **`requireTeacherUserId()`** in the file/CRUD actions) — **never** `session.user.isTeacher` or `requireTeacher()`, which ignore "view as student" mode.
- The session user id is the Entra **`oid`**, not `sub`.
- Student access to any activity is gated by **`checkCode()`** on the stored `novedu_codes` row plus the **stateless-HMAC `x-thread-token`** over `(code, userId, threadId)` — both re-verified on **every** server touch, never a bare DB lookup. There are no signed links (`docs/codes.md`).
- The activity YAML's **`anonymous` default is module-specific**: tutor/quiz default `true`, **writing defaults `false`**, coding is always anonymous. An anonymous writing code disables saving; the save action re-reads the flag live and rejects (`docs/writing.md`).
- The quiz **grader agent (`quizEvaluator`) is never web-reachable** — only `submitAnswer` calls it; the runtime route 404s it. The server-only quiz `evaluation` prompts never reach the browser (`docs/codes.md`).
- Exactly **two public, non-Entra routes**, both in the `proxy.ts` matcher: `GET /api/files/<name>` (raw YAML) and the coding module's `POST /api/coding/v1/chat/completions` (the **code is the bearer API key**, `checkCode` re-verified every request; always anonymous; the teacher's prompt + pinned model stay server-side — `docs/files.md`, `docs/coding.md`). The only other public surface is the **static teacher guide under `/docs`** — plain files from `public/docs/`, no route handler, public by intent (`docs/teacher-docs.md`).
- CLI/API **Entra-bearer routes** (`GET /api/me`; the teacher-only `GET`/`POST /api/codes`, `GET /api/files`, `PUT /api/files/<name>`, the teacher-only images `GET /api/images`, `POST /api/images/<name>`, `POST /api/images/<name>/confirm` (metadata + SAS only — bytes stay direct-to-blob), and the teacher-only reports triage `GET /api/reports`, `GET /api/reports/<id>`, `POST /api/reports/resolve`) are proxy-excluded per-path and gated **only** by `requireBearerUser` / `requireBearerTeacher` (`lib/api-auth.ts`) — token validated on every request, user id is the `oid`, groups overage fails closed, **no student mode on this channel**. The write routes run the web actions' pipelines via `lib/code-service.ts` / `lib/file-service.ts` / `lib/image-service.ts` (auth never enters the services). `requireEffectiveTeacher()` remains the rule for cookie-session surfaces (`docs/api.md`).
- **LLM connectivity is server-only** behind `lib/llm/` — the SCCH/Azure-Foundry branch exists ONLY in `resolveLanguageModel`, `resolveChatEndpoint`, and `providerUnavailableReason`; endpoints, the SCCH key, and Entra tokens never reach the browser. Foundry auth is **passwordless Entra** — never `DefaultAzureCredential`, never an API key. The YAML's `llm.provider`/`llm.model` are the defaults; a code's **LLM override pair** (both-or-nothing) replaces them via `effectiveLlm`, availability-gated on the effective provider (`docs/ai-models.md`).
- Image bytes use **passwordless User-Delegation-SAS** (no app route serves bytes); SVG renders only via `<img src>` on the blob origin — never inline markup (`docs/images.md`).
- Telemetry carries **no** message / prompt / PII content (`docs/telemetry.md`).
- **Usage metering** writes two **independent** hourly buckets — `usage_by_code` (no user) and `usage_by_user` (no code). There is **never** a `(user × code)` row; ids + counts only, never content (`docs/usage-metering.md`).
- Fork-PR CI stays **secret-free**; never add `pull_request_target` (`docs/ci-security.md`).
- Production SQL is **always** passwordless Entra / Managed Identity; SQL user/password is dev/test only (`docs/database.md`).

## Subsystem map

Deep reference for each subsystem lives in `docs/`. These docs are **not** auto-loaded — read the linked one BEFORE working in that area. The bullets below are only the invariants that apply even when you don't open the doc.

### Auth, teacher roles & student mode → `docs/auth.md`

Read before touching: `auth.ts`, `proxy.ts`, sessions, teacher gating, student mode.

- Microsoft Entra ID via Auth.js v5; the gate is `proxy.ts` at the repo root (Next 16's rename of `middleware`, Node.js runtime).
- Teacher gating goes through `requireEffectiveTeacher()` (`lib/student-mode.ts`) — see the security block.
- `novedu_users` maps the `oid` to a display name (upserted per sign-in; teacher surfaces LEFT-JOIN it by value, oid fallback).

### CLI / API bearer auth → `docs/api.md`

Read before touching: `lib/api-auth.ts`, `app/api/me/**`, `app/api/codes/**`, the bearer handlers in `app/api/files/**`, `app/api/images/**`, `app/api/reports/**`, `cli/src/auth.ts`, `cli/src/api.ts`, `cli/src/commands/{login,logout,whoami,codes,files,images,reports}.ts`, or when adding a bearer-protected endpoint.

- The CLI is a public client of the same app registration; tokens carry the `cli.access` scope and are validated per request by `lib/api-auth.ts` — see the security block.
- Adding a bearer endpoint = route gated by `requireBearerUser`/`requireBearerTeacher` + its own path-bounded `proxy.ts` exclusion + a `docs/api.md` entry.
- The `codes`/`files` CLI commands are JSON-only (success on stdout, failures — incl. the server's structured validation errors — on stderr, exit 1); the routes mirror the web lists' filter params with `mine` defaulting on. The ONE exception is `codes sync` (`docs/registry.md`), which prints a per-entry report and keeps JSON behind `--json`; hard failures stay JSON on stderr.
- Tests substitute only the signing key (`API_AUTH_JWKS_PATH`, non-production only); issuer/audience are never overridable. `NOVEDU_TOKEN` (client side, `cli/src/auth.ts`) skips the interactive login for tests/CI only — the server still validates every token.

### Activity registry & `codes sync` → `docs/registry.md`

Read before touching: `lib/registry-schema.ts`, `cli/src/registry.ts`, `cli/src/sync.ts`, the `sync` subcommand in `cli/src/commands/codes.ts`, or the fake `/api/codes` in `test-fixtures/serve.mjs`.

- A hand-written registry in the CONSUMER repo lists activities under stable keys; `codes sync` reconciles it with the server and rewrites a committed `activity-codes` lock file the publication renders from offline. **No server-side change** — matching is client-side over `GET /api/codes`.
- `lib/registry-schema.ts` owns the FORMAT (group names, key rules, entry fields) and is the zod root `lib/schema-gen` generates the editor JSON Schema from; `cli/src/registry.ts` owns the parsing STRATEGY (`activities` stays opaque to zod so the hand-written walk names the exact YAML path). Group names come from `GROUP_MODULES`, so the two cannot drift.
- Match = URL + module + window (compared as instants) + llm pair; `note` is excluded. No match → mint. Existing codes are NEVER modified or deleted: changed parameters produce a new code and the old one is only reported as superseded.
- A registry error aborts before any server call; one entry's mint failure never aborts the run, and the lock keeps that entry's previous code (exit 1 all the same).

### Codes → `docs/codes.md`

Read before touching: `app/[code]/**`, `app/codes/**`, `app/api/copilotkit/**`, `lib/code-*.ts`, `lib/code-modules/**`, `lib/file-validators.ts`, `lib/quiz-*.ts`, `lib/thread-token.ts`. The document-level fragment block each activity embeds is the shared prompt-fragment core (`lib/prompt-fragments/**`, `docs/prompt-fragments.md`).

- Every shareable activity is a `novedu_codes` row at `/<code>`; `module` dispatches renderer + agent. `checkCode()` gates **three** sites that must stay in sync: the `/[code]` dispatcher, the CopilotKit route, and the public coding route.
- Three fixed layers: **FileKind** → **validator** (`lib/file-validators.ts`, the single source of truth for "valid? + metadata") → **CodeModule** descriptor (`lib/code-modules/`). Adding a module touches only the documented seams; the generic flow (store, runtime route, attribution) never changes.
- Editing a code changes only note + window + the LLM override pair — never the module, `file_url`, or the frozen `anonymous`. The teacher side is role-gated, not owner-gated; Mastra memory `resourceId` is the code.
- `novedu_user_chats` is the only user↔chat link, written only for non-anonymous activities; the frozen row `anonymous` governs stats display while attribution reads the YAML live. The **one sanctioned exception** is `novedu_reports` — a voluntary, student-initiated report that stores the reporter's oid even on an anonymous code, behind an explicit on-form "reports are not anonymous" notice (`docs/reports.md`).

### Reports → `docs/reports.md`

Read before touching: `lib/report-types.ts`, `lib/report-store.ts`, `lib/report-actions.ts`, `lib/quiz-verify.ts`, `components/report-button.tsx` + its four mounts (`app/tutor-chat.tsx`, `app/[code]/_quiz/{quiz-discussion,quiz-runner}.tsx`, `app/[code]/_writing/writing-chat.tsx`), `app/reports/**`, `app/api/reports/**`, `cli/src/commands/reports.ts`, or the `novedu_reports` table.

- A student flags a chat or a graded quiz answer with a reaction + optional note; the teacher-only `/reports` inbox triages them (`isEffectiveTeacher()`-gated, filtered-list pattern, bulk resolve/reopen/delete; resolved ⇔ `resolved_at` non-null).
- ALWAYS attributed to the reporter's oid even on anonymous codes (the sanctioned exception above) — the store never joins `novedu_user_chats`; telemetry is content-free (`kind`/`reaction`/`code` only).
- Chat reports prove thread ownership via `verifyThreadToken`; quiz reports carry a server-authoritative question snapshot via `verifyAndLoadQuestion`. **`lib/quiz-verify.ts` must never gain the `"use server"` directive** (it would mint an endpoint leaking the quiz `evaluation` prompts).

### Prompt fragments → `docs/prompt-fragments.md`

Read before touching: `lib/prompt-fragments/**`, `lib/tutors/**`, or a consumer's fragment wiring (`lib/quiz-fetch.ts`, `lib/writing-fetch.ts`, `lib/coding-fetch.ts`).

- The shared prompt-fragment core (`lib/prompt-fragments/`) is the ONE home of Handlebars — all four kinds (tutor, quiz, writing, coding) call `assembleFragmentPrompt`, passing their host text; none touch Handlebars or `COMPILE_OPTIONS`. Fragments are placed inline in the host text (no `priority`, no document-level `fragments:` list). Plain-text files are declared in `text_files:` (one alias namespace shared with `fragment_files`) and embedded inline with `{{file "alias" from= to=}}` markers — spliced **verbatim, never compiled** (a literal `{{` in fetched content survives). Template-semantics opt-in: an activity declaring NEITHER list returns its host text byte-verbatim.
- `handlebars` is imported by EXACTLY three files (`assemble.ts`, `fragment.ts`, `host-template.ts`), enforced by the `isolation.unit.test.ts` grep-guard — `text-files.ts` stays out of it (verbatim splicing, no Handlebars).
- Runtime loaders pass `validateLibraries: false` (hot path, fail closed on any fragment error); authoring validators + the CLI pass `true` (thorough whole-library check).

### Writing → `docs/writing.md`

Read before touching: `lib/writing-*.ts`, `app/[code]/_writing/**`, `app/codes/[code]/s/**`, `app/mastra/writing-agents.ts`, `novedu_writing_submissions`.

- The feedback agent reads the draft via the read-only `getCurrentText` frontend tool and has **no write tool** — it cannot edit the student's text by construction.
- One upserted submission per `(code, student)`, saved only when non-anonymous; writing defaults `anonymous: false` — see the security block.
- Student-authored Markdown is untrusted: always render through the sanitized `MarkdownRenderer` (no `rehype-raw`).

### Coding → `docs/coding.md`

Read before touching: `app/api/coding/**`, `app/[code]/_coding/**`, `lib/coding-*.ts`, `lib/llm/endpoint.ts`, the `api/coding` matcher in `proxy.ts`.

- An OpenAI-compatible endpoint for external coding agents; **no in-app chat, no Mastra** — a thin pass-through proxy that appends the teacher's prompt, pins the (effective) model, and pipes the stream back unparsed.
- The route stays provider-blind through the side-effect-free `resolveChatEndpoint` (`lib/llm/endpoint.ts` must NOT import `app/mastra/scch.ts` or Handlebars/the fragment core — prompt-fragment assembly stays in `loadCoding`, `docs/prompt-fragments.md`).
- Access/anonymity model: see the security block.

### AI models & LLM providers → `docs/ai-models.md`

Read before touching: `lib/llm/**`, `app/mastra/scch.ts`, `lib/scch-endpoint.ts`, the `llm:` block of any activity schema.

- The provider branch exists in exactly THREE functions (see the security block); adding a provider = one branch in each + a name constant + the schema enum literal.
- The `createOpenAI` **names** (`scch`/`azure-foundry`) are the metering contract — renaming breaks usage attribution.
- Foundry is optional: without `AZURE_FOUNDRY_ENDPOINT` the app runs SCCH-only; `providerUnavailableReason` gates save time and runtime.

### Chat (CopilotKit surface) → `docs/chat.md`

Read before touching: `app/module-chat.tsx`, the per-module chat components, `app/codes/[code]/c/[threadId]/conversation-view.tsx`, `lib/runtime-headers.ts`.

- `ModuleChat` is the single live-chat primitive (provider, explicit `threadId`, runtime headers); modules pass `agentId` + extras as slots.
- The read-only transcript `ConversationView` is NOT a `ModuleChat` — no agent is ever run or connected there.

### App-hosted YAML files → `docs/files.md`

Read before touching: `app/files/**`, `app/api/files/**`, `lib/file-store.ts`, `lib/file-service.ts`, `lib/yaml-files.ts`, `novedu_files`.

- `novedu_files` is temporal / append-only (active row = `valid_until IS NULL`); `lib/file-store.ts` is the only access; saving validates first.
- `lib/yaml-files.ts` is the client-safe facade (the student GUI's only app import) and must not import `lib/file-store.ts`.
- App-hosted URL resolution goes through the shared `appHostedFetcher` — never a loopback fetch.

### App-hosted images → `docs/images.md`

Read before touching: `app/images/**`, `app/api/images/**`, `lib/image-*.ts`, `components/content-image.tsx`, `novedu_images`.

- Temporal / append-only metadata + Blob Storage bytes; upload is confirm-only (SAS → PUT → confirm), retrieval is direct-to-blob via short-lived SAS — do NOT add an `/api/images` byte route (the bearer routes under that prefix carry metadata + SAS URLs only).
- Modules embed an `ImageRef`; `resolveImageRef` resolves leniently (`null` ⇒ omit) and `<ContentImage>` renders it.

### Student YAML GUI module → `docs/yaml-gui-student-contribution.md`

Read before touching: `app/files/gui/**`, `lib/yaml-files.ts`.

- `app/files/gui/_studio/**` is student-owned client-side React; the `page.tsx` shells are app-owned (gate + server load). The students' only app import is `@/lib/yaml-files`.

### Styling → `docs/styling.md`

Read before touching: `app/globals.css`, `components/ui/**`, `lib/utils.ts`, or any non-trivial `className` work.

- Tailwind v4, CSS-first: all config lives in `app/globals.css`; light-only. App CSS stays inside the declared layers — an unlayered rule silently breaks CopilotKit's utilities.
- A recipe used in ≥2 places becomes a cva primitive in `components/ui/`, consumed via `cn()`; no `@apply`. Markdown renders through `MarkdownRenderer`.

### Filtered lists → `docs/filtered-lists.md`

Read before touching: `components/data-list.tsx`, `components/list-*.tsx`, `lib/db/text-filter.ts`, or a list page's `searchParams`.

- Filtering happens in the database via URL search params — never in memory; aggregated columns are one aggregate query over the filtered set, never per row.
- Delete is **bulk-only** ("Delete Selected") — no per-row or edit-page delete anywhere.

### Azure SQL, Drizzle & credentials → `docs/database.md`

Read before touching: Mastra storage (`app/mastra/index.ts`), `lib/db/`, migrations, `instrumentation.ts`.

- Every pool builds its config via `buildMssqlConnectionConfig()` — the one auth seam (SQL auth vs. passwordless Entra, picked from the connection string; never `DefaultAzureCredential`).
- App tables use the `novedu_` prefix, migrated by Drizzle at startup; **no foreign keys** between `novedu_*` and `mastra_*`.

### Telemetry → `docs/telemetry.md`

Read before touching: `instrumentation.ts`, `lib/telemetry.ts`, any `recordError` / `emitEvent` call site.

- Off unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is set (a secret). Everything goes through the `lib/telemetry.ts` seam; no PII — see the security block.

### Usage metering → `docs/usage-metering.md`

Read before touching: `lib/usage-store.ts`, `app/mastra/usage-exporter.ts`, `lib/usage-context-keys.ts`, the capture points (CopilotKit route, quiz/writing actions, coding proxy).

- Two independent hourly aggregate tables, written off the response path by the never-throwing `lib/usage-store.ts`. Agent tokens are captured by a Mastra observability exporter reading spans; the coding proxy taps its passthrough stream. Anonymity: see the security block.

### Usage dashboard → `docs/dashboard.md`

Read before touching: `app/usage/**`, `lib/usage-stats-store.ts`, `lib/usage-range.ts`.

- Teacher-only, server-first read surface over `usage_by_code` — no `/api/usage/*` route; one query per chart/KPI; all windows UTC.

### CI / GitHub Actions security → `docs/ci-security.md`

Read before touching: `.github/workflows/`, or adding a secret / real infra to CI.

- Public teaching repo: fork PRs run untrusted code. `qa.yml` stays secret-free (ephemeral SQL container for `@live-db`); secrets live only in `docker-publish.yml`.

### Testing → `docs/testing.md`

Read before adding a test or tagging one `@live`.

- Prefer fast, secret-free unit/component tests; `@live` only when the real DB/LLM/storage is genuinely needed, always with exactly one of `@live-db` / `@live-llm` / `@live-storage`. CI runs hermetic + `@live-db` only.
- Mock the I/O seams, but keep security-critical pure modules (e.g. `lib/thread-token.ts`) real.

### CLI publishing → `docs/cli-publish.md`

Read before touching: `cli/package.json`, `.github/workflows/publish-cli.yml`, or cutting a CLI release.

- Publishes as `@novedu/cli` via OIDC trusted publishing on a `cli-v*` tag — no `NPM_TOKEN`; the workflow fails fast unless the tag matches `cli/package.json`.

### Teacher docs & docs site → `docs/teacher-docs.md`

Read before touching: `teacher-docs/**`, `teacher-docs-site/**`, `.agents/skills/novedu-teacher-docs/**`.

- `teacher-docs/content/` is **generated** — edit the chapter prompt in `teacher-docs/prompts/` and regenerate via the `novedu-teacher-docs` skill, never the output. Chapter bodies carry no `#` H1 (title renders from frontmatter).
- The corpus is authoritative and site-agnostic; `teacher-docs-site/` (Astro Starlight) adapts to it and never modifies it. The site ships **publicly at `/docs` inside the web app** (built into `public/docs/` by the Docker image build; `proxy.ts` excludes the prefix). The corpus contract is enforced by `teacher-docs-site/src/lib/corpus-contract.unit.test.ts` (runs in `qa`) and by `npm run docs:build` (in `qa.yml` and the corpus-PR `docs.yml`).
