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

## Security & privacy invariants

The highest-cost rules to break. They always apply, regardless of which subsystem you are in.

- Gate teacher-only server actions / route handlers with **`requireEffectiveTeacher()`** (or **`requireTeacherUserId()`** in the file/CRUD actions) — **never** `session.user.isTeacher` or `requireTeacher()`, which ignore "view as student" mode.
- The session user id is the Entra **`oid`**, not `sub`.
- Student access to any activity (tutor chat / quiz / writing) is gated by **`checkCode()`** on the stored `novedu_codes` row plus the **stateless-HMAC `x-thread-token`** thread-ownership token over `(code, userId, threadId)` — both re-verified on **every** server touch, never a bare DB lookup. There are no signed links; a quiz is just a code with `module: "quiz"`.
- The activity YAML's **`anonymous` default is module-specific**: tutor and quiz default **`true`** (nothing is attributed unless the YAML opts out), but **writing defaults `false`** (review + Save need attribution). An anonymous writing code disables saving; the save action re-reads the flag **live** and rejects.
- The quiz **grader agent (`quizEvaluator`) is never web-reachable** — it is not any module's runtime agent, so the runtime route 404s it; only `submitAnswer` calls it. The server-only quiz `evaluation` prompts never reach the browser.
- Public **`GET /api/files/<name>`** is intentionally unauthenticated; every other file path is a teacher-only server action. Keep the route in the `proxy.ts` matcher.
- The **`coding`** module's **`POST /api/coding/v1/chat/completions`** is the second public, non-Entra route (also in the `proxy.ts` matcher): an external coding agent has no session, so it authenticates with the **code as the bearer API key** (`checkCode` re-verified every request — never a bare lookup). It has **no** in-app chat and **no** `x-thread-token`. It is **always anonymous** (the API path carries no `oid`), and the teacher's system prompt + the SCCH model stay **server-side** (the proxy injects the prompt and pins the model; neither reaches the browser).
- Image bytes use **passwordless User-Delegation-SAS** (account keys disabled on the storage account); retrieval is unauthenticated-but-time-limited (a short-lived read SAS, no app route serves bytes), and SVG is rendered only via `<img src>` on the blob origin — never inline markup.
- Telemetry carries **no** message / prompt / PII content.
- **Usage metering** stores counts against two **independent** hourly buckets — `usage_by_code` (no user) and `usage_by_user` (no code). There is **never** a `(user × code)` row, so metering never links a student to an activity — the anonymity invariant is unchanged even for anonymous codes (whose `oid` the runtime knows; it is only ever stored against an hour bucket). The exporter + store carry **ids + counts only**, never message/prompt content.
- Fork-PR CI stays **secret-free**; never add `pull_request_target`.
- Production SQL is **always** passwordless Entra / Managed Identity; SQL user/password is dev/test only.

## Subsystem map

Deep reference for each subsystem lives in `docs/`. These docs are **not** auto-loaded — read the linked one BEFORE working in that area. The invariants below always apply even when you don't open the doc.

### Auth, teacher roles & student mode → `docs/auth.md`

Read before touching: `auth.ts`, `proxy.ts`, sessions, teacher gating, student mode.

- The app is gated by Microsoft Entra ID (Auth.js v5); the gate is `proxy.ts` at the repo root (Next 16 renamed the `middleware` convention to `proxy`, which now defaults to the **Node.js runtime**).
- Teacher gating goes through `requireEffectiveTeacher()` (`lib/student-mode.ts`), which honors student mode — see the security block.
- The `oid` is resolved to a human name via **`novedu_users`** (oid → the nav-bar display name): the `jwt` callback upserts it once per sign-in (`lib/user-name-store.ts`, dynamically imported — the only DB write in auth, swallowed on error, never blocks sign-in), and the teacher review surfaces LEFT-JOIN it BY VALUE with the oid as fallback. No backfill (names fill in as users sign in), no history, no GC.

### Codes → `docs/codes.md`

Read before touching: `app/page.tsx`, `app/[code]/**`, `app/codes/**`, `app/api/copilotkit/**`, `lib/code-*.ts`, `lib/code-modules/**`, `lib/file-validators.ts`, `lib/quiz-*.ts`, `app/mastra/quiz-agents.ts`, `lib/thread-token.ts`, `novedu_codes`, `novedu_user_chats`.

- Every shareable activity is a `novedu_codes` row reached at `/<code>`; `module` (`tutor` | `quiz` | `writing` | `coding`) dispatches the renderer/agent. `checkCode()` gates access in **three** sites that must stay in sync: `app/[code]/page.tsx` (a thin dispatcher), the CopilotKit route (ONE `x-code` header, re-checked on every data request), and the public `coding` route (the code as the bearer key — see the security block).
- Three layers (see the doc): **FileKind** (`lib/file-name.ts`) → a **validator** keyed by kind (`lib/file-validators.ts`, the single source of truth for "valid? + what metadata", plus the runtime-light `readAnonymousFlag`) → a **CodeModule** descriptor (`lib/code-modules/`) that references a `fileKind` (create validation derives from it via the registry's `validateCodeFile` — never a per-descriptor field) and supplies an **optional** CopilotKit runtime agent (`coding` has none — the CopilotKit route 404s a module without a `runtime`) + the teacher `renderDetail` (its `/codes/[code]` detail body — tutor/quiz share `ConversationStats`, writing renders its savers list, coding shows config + connection; no shared "stats shell") + an **optional** `renderResult` override (its `/codes/edit/[code]` result body, dispatched by `renderCodeResult` — defaults to `ShareLinkResult` = the `/<code>` share link for tutor/quiz/writing; coding overrides to show its little-coder config). Adding a module = a descriptor + registry line + a client label + a student render case + a teacher `renderDetail` (+ a `renderResult` override only to replace the default share link, + a validator/`readAnonymousFlag` branch for a new file kind); the generic flow (store, runtime route, attribution) is untouched. `fragment` is a validator with **no** module.
- Student thread isolation is the signed `x-thread-token` (`lib/thread-token.ts`) over `(code, userId, threadId)` — Mastra does not bind a thread to its owner, so without the token any code-holder could read another student's chat. The teacher side is **role-gated, not owner-gated**: any effective teacher may view/edit/delete any code. Mastra memory `resourceId` is the code (every module).
- `novedu_user_chats` is the only user↔chat link, written only when the activity is non-anonymous (the `anonymous` default is module-specific — see the security block). `anonymous` has **two reads**: the frozen row copy governs stats display; the runtime attribution path (`recordUserChat`) reads it **live** from the YAML per file kind.
- Editing a code changes only its note + window (either window bound may be blank — an open-ended code that opens immediately and/or never expires) — never the module, `file_url`, or the frozen `anonymous`. Deleting a code wipes all its Mastra threads/messages; codes are never garbage-collected, so expired ones still list.
- **Quizzes** are the `quiz` module: a quiz is a `novedu_files` row with `kind: "quiz"`, structurally validated at authoring time by a strict Zod gate (`lib/quiz-validate.ts` → `QuizYamlSchema` + a duplicate-question-id check) that blocks an invalid save; `toPublicQuiz` strips the server-only `evaluation` before anything reaches the browser. The lenient runtime `parseQuiz` (student path) is separate. The runner + in-page modal `<dialog>` discussion live in `app/[code]/_quiz/`; the grader (`quizEvaluator`) stays server-only — see the security block.
- List filtering + multi-delete follow `docs/filtered-lists.md`.

### Writing → `docs/writing.md`

Read before touching: `lib/writing-*.ts`, `app/[code]/_writing/**`, `app/[code]/render-writing.tsx`, `app/codes/[code]/s/**`, `app/codes/[code]/conversation-stats.tsx`, `lib/code-stats-actions.ts`, `app/mastra/writing-agents.ts`, `lib/code-modules/writing.ts`, `novedu_writing_submissions`.

- The `writing` module: a student writes Markdown in the `/files` CodeMirror editor (Markdown mode) on a split screen, an AI assistant gives feedback, and the student **saves** their text. It adds itself through the codes seams (descriptor with its `renderDetail` + registry line + label + student render case + a `writing` validator/`readAnonymousFlag` branch + the agent + the store) — the generic flow is untouched.
- The assistant **reads** the live draft via the app's first frontend tool — the read-only, parameter-less **`getCurrentText`** (`useFrontendTool`, forwarded by `@ag-ui/mastra`) — and the `writing` agent has **no** write tool, so it **cannot edit the text** by construction.
- `novedu_writing_submissions` (`lib/writing-store.ts`, the only access) holds one upserted row per `(code, student)` — no history, no foreign keys; saved only when non-anonymous; dropped by the code-delete paths (`deleteCodeRows`). Save is gated by `checkCode` + the session `oid`; the action re-rejects anonymous activities (live YAML read).
- Writing **defaults `anonymous: false`** — see the security block. Teacher review (role-gated, read-only) is the **savers list** (`renderDetail` → `WritingSaversList`) → per-student text page (`/codes/[code]/s/[userId]`: full text + Prev/Next + the student's conversations in a lazy `<dialog>` lightbox via `loadConversationTranscript`); an anonymous writing code has no savers and falls back to `ConversationStats`. The student is shown by **display name** (resolved from `novedu_users`, oid fallback — see the Auth block).
- Student-authored Markdown is **untrusted**: the lightbox and the teacher's student-text page render it through the sanitized `MarkdownRenderer` (no `rehype-raw`).

### Coding → `docs/coding.md`

Read before touching: `app/api/coding/**`, `app/[code]/render-coding.tsx`, `app/[code]/_coding/**`, `lib/coding-*.ts`, `lib/scch-endpoint.ts`, `lib/code-modules/coding.ts`, the `api/coding` matcher in `proxy.ts`, `coding/` (sample YAML).

- The `coding` module: an **OpenAI-compatible Chat Completions endpoint** an external coding agent (e.g. little-coder) points at, so students code against an SCCH model with a teacher-authored system prompt. It adds itself through the codes seams (descriptor **without a `runtime`** + registry line + label + student render case + a `coding` validator/`readAnonymousFlag` branch) — the generic flow is untouched.
- The endpoint is a **thin pass-through proxy** (`app/api/coding/v1/chat/completions`, server-only, no Mastra): `checkCode` (bearer key, verbatim — no `sk-` stripping) → `loadCoding` → **append** the teacher's system prompt to the end of the client's system message (teacher gets the final word) + **pin** the model (`buildUpstreamChatBody`, `lib/coding-proxy.ts`) → forward to `${SCCH_BASE_URL}/chat/completions` with `signal: req.signal` (`lib/scch-endpoint.ts`, side-effect-free — does NOT import `app/mastra/scch.ts`) → **pipe the response stream back unparsed**, so client-side tools + streaming are preserved. Oversized bodies are rejected (`413`). See the security block for the access/anonymity model.
- The student `/<code>` page (`render-coding.tsx`), the teacher `renderDetail` (`_coding/coding-detail.tsx`), and the create/edit `renderResult` (`_coding/coding-result.tsx`) all share `_coding/coding-connection.tsx` (base URL + key + a little-coder `models.json` snippet + a link to little-coder's *configuring models* docs); only the teacher detail shows the server-only system prompt + model. The coding `renderResult` shows this connection config **instead of** the share link the other modules show.
- Authoring **validation is a placeholder** for now (`lib/coding-validate.ts` accepts any file, freezes `anonymous: true`); the lenient runtime read is `parseCoding` (`lib/coding-yaml.ts`). Model **allowlist + `/v1/models`**, **rate limiting**, and **usage metrics** are deferred.

### Chat (CopilotKit surface) → `docs/chat.md`

Read before touching: `app/module-chat.tsx`, `app/tutor-chat.tsx`, `app/_tutor/welcome-view.tsx`, `app/[code]/_writing/writing-chat.tsx`, `app/[code]/_quiz/quiz-discussion.tsx`, `app/codes/[code]/c/[threadId]/conversation-view.tsx`, `lib/runtime-headers.ts`.

- `ModuleChat` (`app/module-chat.tsx`) is the single live-chat primitive: it owns the `CopilotKitProvider` + `CopilotChat`, the `threadId` explicit mode, the `MarkdownRenderer`, and the runtime-header construction. Modules pass `agentId` + their extras (tutor's welcome view, writing's `getCurrentText` tool, quiz's feedback header) as slots/children.
- Runtime headers go through `buildRuntimeHeaders` → `RuntimeHeaders` (`x-code` + `x-thread-token`), re-verified server-side on every request — see **Codes**.
- The read-only transcript `ConversationView` is **NOT** a `ModuleChat` (no agent, no threadId) — it renders the message components directly.

### App-hosted YAML files → `docs/files.md`

Read before touching: `app/files/**`, `app/api/files/**`, `lib/file-store.ts`, `lib/files-actions.ts`, `lib/yaml-files.ts`, `novedu_files`, the `api/files` matcher in `proxy.ts`.

- All file CRUD is teacher-only server actions (`requireTeacherUserId()`); saving validates first, so an invalid file is never persisted. (`GET /api/files/<name>` is the one unauthenticated path — see the security block.)
- `novedu_files` is temporal / append-only (active row = `valid_until IS NULL`, soft-delete only); `lib/file-store.ts` is the only access. "One active version per name" is a DB filtered unique index. Files are never garbage-collected.
- `lib/yaml-files.ts` is the client-safe facade (the student GUI's only app import); it must not import `lib/file-store.ts`. Pure name/kind helpers live in `lib/file-name.ts`.
- App-hosted URL resolution (validator, quiz loader, GUI loader) goes through the shared `appHostedFetcher` (`lib/app-hosted-fetcher.ts`) — don't reimplement it as a loopback fetch.
- List filtering + multi-delete follow `docs/filtered-lists.md`.

### App-hosted images → `docs/images.md`

Read before touching: `app/images/**`, `lib/image-store.ts`, `lib/image-blob.ts`, `lib/image-resolve.ts`, `lib/image-ref.ts`, `lib/relative-url.ts`, `lib/images-actions.ts`, `components/content-image.tsx`, the image helpers in `lib/file-name.ts`, `novedu_images`.

- Module-agnostic subsystem in four layers: storage (`novedu_images` + `lib/image-store.ts` metadata, `lib/image-blob.ts` bytes) → the `/images` teacher surface → the `ImageRef`/`resolveImageRef` resolution primitive → the `<ContentImage>` display. A module embeds an `ImageRef` (`hosted` name | absolute URL | relative path); `resolveImageRef` mints a usable URL, leniently (`null` ⇒ omit).
- `novedu_images` is temporal / append-only (active row = `valid_until IS NULL`, soft-delete only); `lib/image-store.ts` is the only access; one active version per name is a DB filtered unique index; images are never garbage-collected. The bytes live in Blob Storage, addressed by `blob_path`.
- Upload is **confirm-only** (request SAS → direct-to-blob PUT → confirm; no DB row until confirm). Retrieval is direct-to-blob via SAS — there is NO app route serving image bytes, so don't add `/api/images` or change `proxy.ts`. SAS is passwordless User-Delegation — see the security block.
- List filtering + multi-delete follow `docs/filtered-lists.md`.

### Student YAML GUI module → `docs/yaml-gui-student-contribution.md`

Read before touching: `app/files/gui/**`, `lib/yaml-files.ts`.

- `app/files/gui/_studio/**` is student-owned; the two `page.tsx` shells (`edit/[...name]`, `view`) are app-owned — they gate (teacher-only), do the server-only load, and pass plain props. The `_studio` underscore keeps it out of routing.
- The students' only app import is `@/lib/yaml-files` (a convention enforced by review / CODEOWNERS, not lint). They write client-side React only; new server behaviour extends the facade.

### Styling → `docs/styling.md`

Read before touching: `app/globals.css`, `postcss.config.mjs`, `components/ui/**`, `lib/utils.ts`, or any non-trivial `className` work.

- Tailwind CSS v4, CSS-first: all config lives in `app/globals.css` (`:root` tokens + `@theme inline`, shadcn-compatible names; light-only by design — no dark mode). There is no `tailwind.config.js`.
- **Layer discipline:** app CSS stays inside the declared layers — an unlayered rule beats every layered one and silently breaks CopilotKit's compiled utilities. The one sanctioned unlayered rule (scrollbar-gutter) is documented in `globals.css`; the `mantine` layer is reserved.
- **Reuse boundary:** a recipe used in ≥2 places lives as a cva primitive in `components/ui/` (or on the owning shared component), consumed via `cn()` (`lib/utils.ts`, className props are cn-merged deltas). One-off chrome is inline utilities. No `@apply`.
- Markdown always renders through `MarkdownRenderer` (prose); derived tints use the `foreground/N` opacity ramp, not new hex values.

### Filtered lists → `docs/filtered-lists.md`

Read before touching: `components/data-list.tsx`, `components/list-filter-bar.tsx`, `components/list-selection.tsx`, `components/selection-column.tsx`, `lib/db/text-filter.ts`, or a list page's `searchParams`.

- List filtering happens in the database, never in memory: filter state lives in URL search params → a parameterized `WHERE` (text via `containsAny`).
- Build a list from the reusable pieces — `DataList` (server table) + `ListFilterBar` (client) — and wrap in `SelectionProvider` + `selectionColumn` + `DeleteSelectedButton` for multi-delete. The async list page needs a sibling `loading.tsx` rendering `<PageLoading>` (`app/page-loading.tsx`).
- Delete is **bulk-only**: **"Delete Selected"** (multi-delete) is the ONLY way to delete a code/file/image — there is no per-row trash button and no edit-page single delete. The bulk action loops a per-item store helper (`closeActiveFile` / `closeActiveImage` / `deleteCodeRows`+`deleteCodeConversations`) inside one `DbExecutor` transaction. For codes the Mastra thread deletes run per-code outside that transaction (separate pool).
- Aggregated columns are a single raw-SQL aggregate over the filtered set — never a query per row.

### Azure SQL, Drizzle & credentials → `docs/database.md`

Read before touching: Mastra storage (`app/mastra/index.ts`), `lib/db/`, migrations, `instrumentation.ts`.

- Build the SQL connection config via `buildMssqlConnectionConfig()` (`lib/azure-credential.ts`) — the one seam every pool shares. It picks auth from the connection string: SQL auth if it carries `User ID`/`Password`, else passwordless Entra via `buildDataStoreCredential()` (`ChainedTokenCredential(AzureCliCredential, ManagedIdentityCredential)`). Never `DefaultAzureCredential`. (Prod = Entra/MI only — see the security block.)
- `STORAGE_TENANT_ID` is the database's tenant (separate from the sign-in `AZURE_TENANT_ID`).
- App tables use the `novedu_` prefix (`lib/db/schema.ts`), migrated by Drizzle at startup (`npm run db:generate` → commit `drizzle/`). No foreign keys between `novedu_*` and `mastra_*`.

### Telemetry → `docs/telemetry.md`

Read before touching: `instrumentation.ts`, `lib/telemetry.ts`, the `@opentelemetry/*` / `@azure/monitor-opentelemetry` deps, any `recordError` / `emitEvent` call site.

- Telemetry is off unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is set (a secret, never in the repo or CI). Everything goes through the `lib/telemetry.ts` seam; `instrumentation.ts` brings it up before migrations and routes uncaught server errors to `recordError` via `onRequestError`. (No PII — see the security block.)

### Usage metering → `docs/usage-metering.md`

Read before touching: `lib/usage-store.ts`, `app/mastra/usage-exporter.ts`, `lib/usage-context-keys.ts`, the `observability` block in `app/mastra/index.ts`, `novedu_usage_by_code` / `novedu_usage_by_user`, and the capture points in the CopilotKit route / `lib/quiz-actions.ts` / `lib/writing-actions.ts` / the coding proxy.

- Two **independent** hourly aggregate tables written **off the response path** by the never-throwing `lib/usage-store.ts` (increment-UPSERT). No read UI this iteration (query via SQL / Log Analytics); `usage_by_user` is the future per-student-quota substrate (a windowed `SUM`). Token + tool-call capture is a Mastra **`ObservabilityExporter`** (`@mastra/observability`, registered in `app/mastra/index.ts`) reading `MODEL_GENERATION` span `usage` (the `UsageStats` shape: `inputDetails.cacheRead` / `outputTokens`), attributed via three `requestContextKeys` (`usageCode`/`usageUserId`/`usageModule`, `lib/usage-context-keys.ts`) set on the per-request RequestContext at each agent seam; the **coding proxy** (no Mastra) taps its passthrough response for the `usage` chunk (per-code only, no `oid`). `input_tokens_cached` counts prefix-cache hits (SCCH's `prompt_tokens_details.cached_tokens` → Mastra `inputDetails.cacheRead`). Anonymity: see the security block.

### CI / GitHub Actions security → `docs/ci-security.md`

Read before touching: `.github/workflows/`, or adding a secret / real infra to CI.

- Public teaching repo: fork PRs run untrusted code on our runners. `qa.yml` (fork `pull_request`) stays secret-free, with an ephemeral SQL Server container (dummy password) for `@live-db`. Secrets live only in `docker-publish.yml` (push to `main` / `workflow_dispatch`). The live tag is split — `@live-db` runs in CI, `@live-llm` (SCCH, Austria-only) is local-only. (Never `pull_request_target` — see the security block.)

### Testing → `docs/testing.md`

Read before adding a test or tagging one `@live`.

- Prefer fast, secret-free unit/component tests; a test is `@live` only if it genuinely needs the real DB (`@live-db`) or LLM (`@live-llm`). Mock the I/O seams, but keep security-critical pure modules (e.g. `lib/thread-token.ts`) real.
- Every live test carries `@live` plus exactly one of `@live-db` / `@live-llm`. CI runs hermetic + `@live-db` (ephemeral container) and excludes `@live-llm`.

### CLI publishing → `docs/cli-publish.md`

Read before touching: `cli/package.json`, `.github/workflows/publish-cli.yml`, or cutting a CLI release.

- Publishes as `@novedu/cli` via OIDC trusted publishing on a `cli-v*` tag — no `NPM_TOKEN` (keeps CI secret-free).
- `cli/package.json` must keep its `repository` field (`directory: cli`) or `--provenance` fails with HTTP 422.
- Releases are forward-only; the workflow fails fast unless the `cli-vX.Y.Z` tag matches `cli/package.json`.
