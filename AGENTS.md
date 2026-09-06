<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Global rules

- Do **not** push to GitHub unless the user explicitly asks.
- `CLAUDE.md` is a symlink to **`AGENTS.md`** — edit `AGENTS.md`.
- ALL documentation (`docs/**`, `teacher-docs/**`, READMEs, activity guides) describes the **current state only** — no change history, no migration notes, no version-gated remarks ("needs ≥ x", "since version y"). The app is an MVP under heavy development; assume the latest app and CLI are what everyone runs. Describing a live compatibility *mechanism* is fine (e.g. "an outdated CLI rejects unknown provider names — use `npx @novedu/cli@latest`"); naming versions is not.
- Load the **`mastra`** skill before any Mastra work; never rely on cached APIs. Register every agent/tool/workflow/scorer in `app/mastra/index.ts`; use the `dev`/`build` package scripts, never raw `mastra dev`/`mastra build`.
- Research current docs before non-trivial work with **Drizzle** ([llms.txt](https://orm.drizzle.team/llms.txt)), **Tailwind v4** (context7 via `ctx7` — CSS-first, differs from training data), or **Recharts** (context7 `/recharts/recharts`).

## Security & privacy invariants

The highest-cost rules to break. They always apply, regardless of subsystem; the linked doc has the full mechanics.

- Teacher-only server actions / route handlers: **`requireEffectiveTeacher()`** (or `requireTeacherUserId()` in the file/CRUD actions) — **never** `session.user.isTeacher` or `requireTeacher()`, which ignore "view as student" mode.
- The session user id is the Entra **`oid`**, not `sub`.
- Student access to any activity = **`checkCode()`** on the stored `novedu_codes` row + the **stateless-HMAC `x-thread-token`** over `(code, userId, threadId)`, both re-verified on **every** server touch. No signed links (`docs/codes.md`).
- The activity YAML's `anonymous` default is module-specific: tutor/quiz `true`, **writing `false`**, coding always anonymous (`docs/writing.md`).
- The quiz grader **`quizEvaluator`**, the eval judge **`evalJudge`** and the eval tutor **`evalTutor`** are **never web-reachable by students** (the runtime route 404s every agent id but the code module's own). Besides `submitAnswer`, their only callers are the teacher-only `POST /api/eval/grade` / `POST /api/eval/judge` / `POST /api/eval/respond`, which supply their system prompts client-side — the server-only quiz `evaluation` prompts never leave the server (`docs/codes.md`, `docs/cli-eval.md`).
- Exactly **two public, non-Entra API surfaces**: `GET /api/files/<name>` (raw YAML) and the coding routes `POST /api/coding/v1/chat/completions` + `GET /api/coding/v1/models`, both authenticated by a per-user API key from `novedu_coding_keys` under one identical gate (key row + code row re-verified every request — `docs/files.md`, `docs/coding.md`). The only other public surface is the static teacher guide under `/docs`, public by intent (`docs/teacher-docs.md`).
- All other CLI/API routes are **Entra-bearer**: proxy-excluded per-path and gated **only** by `requireBearerUser`/`requireBearerTeacher` (`lib/api-auth.ts`) — token validated on every request, groups overage fails closed, **no student mode on this channel**; auth never enters the `lib/*-service.ts` pipelines. `docs/api.md` lists every route.
- **LLM connectivity is server-only** behind `lib/llm/` — the provider branch exists ONLY in `resolveLanguageModel`, `resolveChatEndpoint`, and `providerUnavailableReason`; endpoints, keys, and Entra tokens never reach the browser. Foundry auth is passwordless Entra — never `DefaultAzureCredential`, never an API key. A code's **LLM override pair** is both-or-nothing via `effectiveLlm`, availability-gated on the effective provider (`docs/ai-models.md`).
- A thinking model's **reasoning is teacher-only on the live chat**: the `/api/copilotkit` route picks `ReasoningStrippingRunner` unless `effectiveTeacherForSession()` proves an effective teacher, so `REASONING_*` frames are never written to a student's stream. **Fails closed**; view-as-student gets a student's stream (`docs/chat.md`).
- Image bytes use passwordless **User-Delegation-SAS** — no app route ever serves bytes; SVG renders only via `<img src>` on the blob origin, never inline markup (`docs/images.md`).
- Telemetry carries **no** message / prompt / PII content (`docs/telemetry.md`).
- Usage metering writes two **independent** hourly buckets — `usage_by_code` (no user) and `usage_by_user` (no code). **Never** a `(user × code)` row; ids + counts only, never content (`docs/usage-metering.md`).
- Fork-PR CI stays **secret-free**; never add `pull_request_target` (`docs/ci-security.md`).
- Production Postgres is always passwordless Entra / Managed Identity; password auth is dev/test only (`docs/database.md`).

## Subsystem map

Deep reference lives in `docs/` — those docs are **not** auto-loaded, so read the linked doc BEFORE working in that area. The bullets below are ONLY the invariants that must hold even when you don't open the doc; everything else lives there.

### Auth, teacher roles & student mode → `docs/auth.md`

Read before touching: `auth.ts`, `proxy.ts`, sessions, teacher gating, student mode.

- Entra ID via Auth.js v5; the gate is `proxy.ts` at the repo root (Next 16's rename of `middleware`, Node.js runtime). Teacher gating: see the security block.

### CLI / API bearer auth → `docs/api.md`

Read before touching: `lib/api-auth.ts`, the bearer handlers under `app/api/**`, `cli/src/auth.ts`, `cli/src/api.ts`, `cli/src/commands/**`, or when adding a bearer-protected endpoint.

- Adding a bearer endpoint = `requireBearer*` gate + its own path-bounded `proxy.ts` exclusion + a `docs/api.md` entry.
- CLI commands are JSON-only (success on stdout, failures on stderr, exit 1); the sanctioned exceptions (`codes sync`, `eval`) print human reports and keep JSON behind `--json`.

### Activity registry & `codes sync` → `docs/registry.md`

Read before touching: `lib/registry-schema.ts`, `cli/src/registry.ts`, `cli/src/sync.ts`, the `sync` subcommand, or the fake `/api/codes` in `test-fixtures/serve.mjs`.

- Sync NEVER modifies or deletes an existing code: changed parameters mint a NEW code; the old one is only reported as superseded. No server-side change — matching is client-side.

### Codes → `docs/codes.md`

Read before touching: `app/[code]/**`, `app/codes/**`, `app/api/copilotkit/**`, `lib/code-*.ts`, `lib/code-modules/**`, `lib/file-validators.ts`, `lib/quiz-*.ts`, `lib/thread-token.ts`.

- `checkCode()` gates THREE sites that must stay in sync: the `/[code]` dispatcher, the CopilotKit route, and the public coding route.
- Fixed layering: **FileKind** → validator (`lib/file-validators.ts`) → **CodeModule** descriptor; adding a module touches only the documented seams.
- Editing a code changes only note + window + the LLM override pair — never the module, `file_url`, or the frozen `anonymous`.
- `novedu_user_chats` is the only user↔chat link, written only for non-anonymous activities. TWO sanctioned exceptions: `novedu_reports` stores the reporter's oid even on anonymous codes behind an explicit on-form notice (`docs/reports.md`), and `novedu_coding_keys` stores the requester's oid behind an explicit on-page notice (`docs/coding.md`).

### Reports → `docs/reports.md`

Read before touching: `lib/report-*.ts`, `lib/quiz-verify.ts`, `components/report-button.tsx` + its mounts, `app/reports/**`, `app/api/reports/**`, `cli/src/commands/reports.ts`, `novedu_reports`.

- Reports are ALWAYS attributed to the reporter's oid (the sanctioned exception above); the store never joins `novedu_user_chats`; telemetry stays content-free.
- **`lib/quiz-verify.ts` must never gain `"use server"`** — it would mint an endpoint leaking the quiz `evaluation` prompts.

### Prompt fragments → `docs/prompt-fragments.md`

Read before touching: `lib/prompt-fragments/**`, `lib/tutors/**`, or a consumer's fragment wiring (`lib/{quiz,writing,coding}-fetch.ts`).

- `lib/prompt-fragments/` is the ONE home of Handlebars: `handlebars` is imported by exactly three files (grep-guarded); every consumer only calls `assembleFragmentPrompt`.
- `text_files` content is spliced **verbatim, never compiled**; an activity declaring neither file list gets its host text byte-verbatim.

### Tutor tools → `docs/tutor-tools.md`

Read before touching: `lib/tutor-tools/**`, `app/mastra/tutor-tools.ts`, the tutor schema's `tools:` field, `app/mastra/tutor-agent.ts` tools resolver.

- `lib/tutor-tools/` is the pure, CLI-bundled catalog (names, schemas, executors with injected effects) — it sits inside the prompt-dump grep-guard closure; the Mastra `createTool` binding lives ONLY in `app/mastra/tutor-tools.ts`.
- Tool grants are top-level `tools:` (enum-validated, default `[]`) — independent of `llm:` and the per-code LLM override; the platform never mentions tools in the prompt (authors do, in `tutor_instructions`).

### Writing → `docs/writing.md`

Read before touching: `lib/writing-*.ts`, `app/[code]/_writing/**`, `app/codes/[code]/s/**`, `app/mastra/writing-agents.ts`, `novedu_writing_submissions`.

- The feedback agent has **no write tool** — it cannot edit the student's text by construction.
- Student-authored Markdown is untrusted: always the sanitized `MarkdownRenderer` (no `rehype-raw`).

### Coding → `docs/coding.md`

Read before touching: `app/api/coding/**`, `app/[code]/_coding/**`, `lib/coding-*.ts` (incl. the key store `lib/coding-key-store.ts`), `lib/llm/endpoint.ts`, the `api/coding` matcher in `proxy.ts`.

- No in-app chat, no Mastra — a thin pass-through proxy. `lib/llm/endpoint.ts` stays side-effect-free and must NOT import `app/mastra/scch.ts` or the fragment core.
- Auth is a per-user API key resolved in the route beside `checkCode`: `lookupCodingKey` (`lib/coding-key-store.ts`) maps the bearer to its `(code, userId)` pair, then `checkCode` re-verifies the code itself — both stored rows, re-checked on every request. Both public routes run that gate identically and reject through the shared `lib/coding-http.ts` helpers, so the cheap `GET .../models` key check is never an oracle the completions route is not.

### AI models & LLM providers → `docs/ai-models.md`

Read before touching: `lib/llm/**`, `app/mastra/scch.ts`, `app/mastra/model-entry.ts`, `lib/scch-endpoint.ts`, the `llm:` block of any activity schema.

- Adding a provider = one branch in each of the THREE functions (security block) + a name constant + the schema enum literal + its `providerOptions` key in `reasoningOptionsKey` (beside `resolveLanguageModel` in `lib/llm/model.ts`).
- The ai-sdk provider names (`scch`/`azure-foundry`/`openrouter`) are the metering contract — renaming breaks usage attribution.
- The agent path uses TWO ai-sdk packages across THREE instances: SCCH and OpenRouter on `@ai-sdk/openai-compatible` (exact-pinned `2.x`, the ai-sdk-v6 line — it alone maps `reasoning_content`, and needs `includeUsage: true` for metering; both share the exported `stripAssistantReasoning`), Foundry on `@ai-sdk/openai`. `providerOptions` keys differ accordingly.

### Chat (CopilotKit surface) → `docs/chat.md`

Read before touching: `app/module-chat.tsx`, the per-module chat components, the transcript `conversation-view.tsx`, `lib/runtime-headers.ts`, `app/api/copilotkit/reasoning-runner.ts`, `app/api/copilotkit/run-error-runner.ts`, `app/mastra/reasoning-processor.ts`, `lib/image-normalize.ts`, `lib/image-report.ts`, `app/image-check/**`.

- `ModuleChat` is the single live-chat primitive; the read-only `ConversationView` is NOT a `ModuleChat` — no agent ever runs there.
- Reasoning is stripped server-side for non-teachers (security block). The runner delegates to a 4-method abstract `AgentRunner` — a guard test reads that method list off the installed package's type declaration, so **wrap any new method before a CopilotKit bump**. The global `messageView.cursor` note ("Generating…") shows for the whole run, for everyone.
- Reasoning is **live-only**: `reasoningStrippingProcessor` (`app/mastra/reasoning-processor.ts`) is on the `outputProcessors` of every agent with `memory:`, so `mastra_messages` never stores a reasoning part. Adding a memory-backed agent means adding it there too.
- EVERY student photo (tutor + quiz) goes through `normalizeStudentImage` in the browser before it is inlined. Two DIFFERENT limits: `MAX_RAW_IMAGE_BYTES` (30 MB) bounds what may be PICKED, `MAX_IMAGE_BYTES` (5 MB) what may be SENT — CopilotKit checks `maxSize` against the ORIGINAL file, so it carries the RAW one. Canvas code never enters `lib/answer-images.ts` (a `"use server"` module imports it).
- A failed turn is in-band on an already-200 stream, so it is reported by the `RunErrorReportingRunner` decorator, which wraps BOTH runner variants; the `RUN_ERROR` message itself never reaches telemetry.

### App-hosted YAML files → `docs/files.md`

Read before touching: `app/files/**`, `app/api/files/**`, `lib/file-store.ts`, `lib/file-service.ts`, `lib/yaml-files.ts`, `novedu_files`.

- `novedu_files` is temporal/append-only; `lib/file-store.ts` is the only access. `lib/yaml-files.ts` is the client-safe facade and must not import the store.
- App-hosted URL resolution goes through the shared `appHostedFetcher` — never a loopback fetch.

### App-hosted images → `docs/images.md`

Read before touching: `app/images/**`, `app/api/images/**`, `lib/image-*.ts`, `components/content-image.tsx`, `novedu_images`.

- Upload is confirm-only (SAS → PUT → confirm); retrieval is direct-to-blob via short-lived SAS — do NOT add an `/api/images` byte route.

### Student YAML GUI module → `docs/yaml-gui-student-contribution.md`

Read before touching: `app/files/gui/**`, `lib/yaml-files.ts`.

- `app/files/gui/_studio/**` is student-owned client-side React; the `page.tsx` shells are app-owned. The students' only app import is `@/lib/yaml-files`.

### Styling → `docs/styling.md`

Read before touching: `app/globals.css`, `components/ui/**`, `lib/utils.ts`, or any non-trivial `className` work.

- Tailwind v4, CSS-first: all config in `app/globals.css`; light-only. App CSS stays inside the declared layers — an unlayered rule silently breaks CopilotKit's utilities.
- A recipe used in ≥2 places becomes a cva primitive in `components/ui/`, consumed via `cn()`; no `@apply`.

### Filtered lists → `docs/filtered-lists.md`

Read before touching: `components/data-list.tsx`, `components/list-*.tsx`, `lib/db/text-filter.ts`, or a list page's `searchParams`.

- Filtering happens in the database via URL search params — never in memory. Delete is bulk-only; no per-row or edit-page delete anywhere.

### Postgres, Drizzle & credentials → `docs/database.md`

Read before touching: Mastra storage (`app/mastra/index.ts`), `lib/db/`, migrations, `instrumentation.ts`.

- Every consumer takes the ONE pool from `getPool()` (`lib/db/pool.ts`) — the one auth seam; app tables use the `novedu_` prefix in `public`, Mastra's live in schema `mastra`; **no foreign keys** between `novedu_*` and `mastra_*`.

### Telemetry → `docs/telemetry.md`

Read before touching: `instrumentation.ts`, `lib/telemetry.ts`, any `recordError`/`emitEvent` call site.

- Off unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is set; everything goes through the `lib/telemetry.ts` seam; no PII (security block).

### Usage metering → `docs/usage-metering.md`

Read before touching: `lib/usage-store.ts`, `app/mastra/usage-exporter.ts`, `lib/usage-context-keys.ts`, the capture points.

- Written off the response path by the never-throwing `lib/usage-store.ts`. Anonymity: see the security block.

### Usage dashboard → `docs/dashboard.md`

Read before touching: `app/usage/**`, `lib/usage-stats-store.ts`, `lib/usage-range.ts`.

- Teacher-only, server-first read surface over `usage_by_code` — no `/api/usage/*` route; all windows UTC.

### CI / GitHub Actions security → `docs/ci-security.md`

Read before touching: `.github/workflows/`, or adding a secret / real infra to CI.

- Public teaching repo: fork PRs run untrusted code. `qa.yml` stays secret-free; secrets live only in `docker-publish.yml`.

### Testing → `docs/testing.md`

Read before adding a test or tagging one `@live`.

- Prefer fast, secret-free tests; `@live` only when the real DB/LLM/storage is genuinely needed, always with exactly one of `@live-db`/`@live-llm`/`@live-storage`. CI runs hermetic + `@live-db` only.
- Mock the I/O seams, but keep security-critical pure modules (e.g. `lib/thread-token.ts`) real.

### CLI prompt dumps → `docs/cli-prompts.md`

Read before touching: `lib/prompt-dump.ts`, `lib/{quiz,writing,coding}-resolve.ts`, the prompt builders, `cli/src/commands/prompts.ts`.

- Every dumper CALLS the production builders/loaders — never a copy (grep-guarded in `lib/prompt-dump.unit.test.ts`).
- CLI-bundled `lib/**` must import **nothing** from `app/**`, the DB, or `lib/llm/model.ts`, and carry no `"use server"` — the grep-guard walks the whole transitive closure.
- Changing anything in that bundled closure warrants a CLI release (`docs/cli-publish.md`) — published CLIs carry a frozen copy.

### CLI evals (quiz + tutor) → `docs/cli-eval.md`

Read before touching: `lib/eval-schema.ts`, `lib/eval-validate.ts`, `lib/quiz-feedback-judge.ts`, `lib/tutor-judge.ts`, `cli/src/eval-run.ts`, `cli/src/report-md.ts`, `cli/src/retry.ts`, `cli/src/commands/eval.ts`, `app/api/eval/**`, `app/mastra/eval-agents.ts`, or the fake grader/judge/tutor in `test-fixtures/serve.mjs`.

- The eval file is a discriminated union on `kind`: omitted / `quiz` = golden answers, `tutor` = scripted conversations. The kind is INFERRED from each file — no flag — and a batch may mix them.
- The CLI assembles every prompt OFFLINE (via `dumpPrompts`) and fans out; the teacher-only `POST /api/eval/grade` grades exactly ONE answer and `POST /api/eval/respond` generates exactly ONE tutor turn per request — stateless, nothing persisted. Access model: see the security block.
- The **judge** REPORTS and never gates for BOTH kinds (a flag changes no exit code), and DEGRADES rather than aborting when the judge model fails. `POST /api/eval/judge` is kind-agnostic — both prompts and the criteria arrive in the body — so a further eval kind reuses it with no server change.
- The tutor kind's exit code reflects **run health only** (invalid files, `errored`, `skipped`); the Markdown report is the deliverable.

### CLI publishing → `docs/cli-publish.md`

Read before touching: `cli/package.json`, `.github/workflows/publish-cli.yml`, changing CLI-bundled `lib/**` code, or cutting a CLI release.

- Publishes as `@novedu/cli` via OIDC trusted publishing on a `cli-v*` tag — no `NPM_TOKEN`; the tag must match `cli/package.json`.
- A change to CLI-bundled `lib/**` (validators, prompt builders, schemas) is release-worthy even with no `cli/` diff: bump `cli/package.json` and publish, or teachers keep running the old code (`docs/cli-publish.md`).

### Teacher docs & docs site → `docs/teacher-docs.md`

Read before touching: `teacher-docs/**`, `.agents/skills/novedu-teacher-docs/**`.

- `teacher-docs/src/content/docs/` is the **human-owned source of truth** — edit chapters directly (by hand or via the `novedu-teacher-docs` skill); read the chapter's entry in `docs/teacher-docs-notes.md` before editing; keep chapters current by reasoning over the git diff with `teacher-docs/CHAPTERS.md` as the map.
- The corpus is authoritative and site-agnostic; the site adapts to it, never modifies it, and ships publicly at `/docs` inside the web app — HTML pages plus the llms.txt surface (`llms.txt`, `llms-full.txt`, per-chapter `.md` twins).
- A new corpus section directory must be declared in `teacher-docs/CHAPTERS.md` **and** `teacher-docs/src/lib/sections.ts` — the site build throws on an undeclared one.
