<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Global rules

- Do **not** push to GitHub unless the user explicitly asks.
- `CLAUDE.md` is a symlink to **`AGENTS.md`** — edit `AGENTS.md`.
- Load the **`mastra`** skill before any Mastra work; never rely on cached APIs. Register every agent/tool/workflow/scorer in `app/mastra/index.ts`; use the `dev`/`build` package scripts, never raw `mastra dev`/`mastra build`.
- Research current docs before non-trivial work with **Drizzle** ([llms.txt](https://orm.drizzle.team/llms.txt)), **Tailwind v4** (context7 via `ctx7` — CSS-first, differs from training data), or **Recharts** (context7 `/recharts/recharts`).

## Security & privacy invariants

The highest-cost rules to break. They always apply, regardless of subsystem; the linked doc has the full mechanics.

- Teacher-only server actions / route handlers: **`requireEffectiveTeacher()`** (or `requireTeacherUserId()` in the file/CRUD actions) — **never** `session.user.isTeacher` or `requireTeacher()`, which ignore "view as student" mode.
- The session user id is the Entra **`oid`**, not `sub`.
- Student access to any activity = **`checkCode()`** on the stored `novedu_codes` row + the **stateless-HMAC `x-thread-token`** over `(code, userId, threadId)`, both re-verified on **every** server touch. No signed links (`docs/codes.md`).
- The activity YAML's `anonymous` default is module-specific: tutor/quiz `true`, **writing `false`**, coding always anonymous (`docs/writing.md`).
- The quiz grader **`quizEvaluator`**, the eval judge **`evalJudge`** and the eval tutor **`evalTutor`** are **never web-reachable by students** (the runtime route 404s every agent id but the code module's own). Besides `submitAnswer`, their only callers are the teacher-only `POST /api/eval/grade` / `POST /api/eval/judge` / `POST /api/eval/respond`, which supply their system prompts client-side — the server-only quiz `evaluation` prompts never leave the server (`docs/codes.md`, `docs/cli-eval.md`).
- Exactly **two public, non-Entra API routes**: `GET /api/files/<name>` (raw YAML) and the coding `POST /api/coding/v1/chat/completions` (the code IS the bearer key — `docs/files.md`, `docs/coding.md`). The only other public surface is the static teacher guide under `/docs`, public by intent (`docs/teacher-docs.md`).
- All other CLI/API routes are **Entra-bearer**: proxy-excluded per-path and gated **only** by `requireBearerUser`/`requireBearerTeacher` (`lib/api-auth.ts`) — token validated on every request, groups overage fails closed, **no student mode on this channel**; auth never enters the `lib/*-service.ts` pipelines. `docs/api.md` lists every route.
- **LLM connectivity is server-only** behind `lib/llm/` — the provider branch exists ONLY in `resolveLanguageModel`, `resolveChatEndpoint`, and `providerUnavailableReason`; endpoints, keys, and Entra tokens never reach the browser. Foundry auth is passwordless Entra — never `DefaultAzureCredential`, never an API key. A code's **LLM override pair** is both-or-nothing via `effectiveLlm`, availability-gated on the effective provider (`docs/ai-models.md`).
- Image bytes use passwordless **User-Delegation-SAS** — no app route ever serves bytes; SVG renders only via `<img src>` on the blob origin, never inline markup (`docs/images.md`).
- Telemetry carries **no** message / prompt / PII content (`docs/telemetry.md`).
- Usage metering writes two **independent** hourly buckets — `usage_by_code` (no user) and `usage_by_user` (no code). **Never** a `(user × code)` row; ids + counts only, never content (`docs/usage-metering.md`).
- Fork-PR CI stays **secret-free**; never add `pull_request_target` (`docs/ci-security.md`).
- Production SQL is always passwordless Entra / Managed Identity; SQL user/password is dev/test only (`docs/database.md`).

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
- `novedu_user_chats` is the only user↔chat link, written only for non-anonymous activities. The ONE sanctioned exception: `novedu_reports` stores the reporter's oid even on anonymous codes, behind an explicit on-form notice (`docs/reports.md`).

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

Read before touching: `app/api/coding/**`, `app/[code]/_coding/**`, `lib/coding-*.ts`, `lib/llm/endpoint.ts`, the `api/coding` matcher in `proxy.ts`.

- No in-app chat, no Mastra — a thin pass-through proxy. `lib/llm/endpoint.ts` stays side-effect-free and must NOT import `app/mastra/scch.ts` or the fragment core.

### AI models & LLM providers → `docs/ai-models.md`

Read before touching: `lib/llm/**`, `app/mastra/scch.ts`, `lib/scch-endpoint.ts`, the `llm:` block of any activity schema.

- Adding a provider = one branch in each of the THREE functions (security block) + a name constant + the schema enum literal.
- The `createOpenAI` names (`scch`/`azure-foundry`) are the metering contract — renaming breaks usage attribution.

### Chat (CopilotKit surface) → `docs/chat.md`

Read before touching: `app/module-chat.tsx`, the per-module chat components, the transcript `conversation-view.tsx`, `lib/runtime-headers.ts`.

- `ModuleChat` is the single live-chat primitive; the read-only `ConversationView` is NOT a `ModuleChat` — no agent ever runs there.

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

### Azure SQL, Drizzle & credentials → `docs/database.md`

Read before touching: Mastra storage (`app/mastra/index.ts`), `lib/db/`, migrations, `instrumentation.ts`.

- Every pool builds its config via `buildMssqlConnectionConfig()` — the one auth seam. App tables use the `novedu_` prefix; **no foreign keys** between `novedu_*` and `mastra_*`.

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

Read before touching: `teacher-docs/**`, `teacher-docs-site/**`, `.agents/skills/novedu-teacher-docs/**`.

- `teacher-docs/content/` is **generated** — edit the chapter prompt in `teacher-docs/prompts/` and regenerate via the `novedu-teacher-docs` skill, never the output.
- The corpus is authoritative and site-agnostic; the site adapts to it, never modifies it, and ships publicly at `/docs` inside the web app — HTML pages plus the llms.txt surface (`llms.txt`, `llms-full.txt`, per-chapter `.md` twins).
- A new corpus section directory must be declared in `teacher-docs/CHAPTERS.md` **and** `teacher-docs-site/src/lib/sections.ts` — the site build throws on an undeclared one.
