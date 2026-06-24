<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Global rules

- Do **not** push to GitHub unless the user explicitly asks.
- `CLAUDE.md` is a symlink to **`AGENTS.md`** — edit `AGENTS.md`.
- Load the **`mastra`** skill before any Mastra work; never rely on cached APIs. Register every agent/tool/workflow/scorer in `app/mastra/index.ts`, and use the `dev`/`build` package scripts, not raw `mastra dev` / `mastra build`.
- Research the [Drizzle docs](https://orm.drizzle.team/llms.txt) before complex queries, transactions, or migrations.

## Security & privacy invariants

The highest-cost rules to break. They always apply, regardless of which subsystem you are in.

- Gate teacher-only server actions / route handlers with **`requireEffectiveTeacher()`** (or **`requireTeacherUserId()`** in the file/CRUD actions) — **never** `session.user.isTeacher` or `requireTeacher()`, which ignore "view as student" mode.
- The session user id is the Entra **`oid`**, not `sub`.
- Student access to any activity (tutor chat / quiz) is gated by **`checkCode()`** on the stored `novedu_codes` row plus the **stateless-HMAC `x-thread-token`** thread-ownership token over `(code, userId, threadId)` — both re-verified on **every** server touch, never a bare DB lookup. There are no signed links; a quiz is just a code with `module: "quiz"`.
- The quiz **grader agent (`quizEvaluator`) is never web-reachable** — it is not any module's runtime agent, so the runtime route 404s it; only `submitAnswer` calls it. The server-only quiz `evaluation` prompts never reach the browser.
- Public **`GET /api/files/<name>`** is intentionally unauthenticated; every other file path is a teacher-only server action. Keep the route in the `proxy.ts` matcher.
- Image bytes use **passwordless User-Delegation-SAS** (account keys disabled on the storage account); retrieval is unauthenticated-but-time-limited (a short-lived read SAS, no app route serves bytes), and SVG is rendered only via `<img src>` on the blob origin — never inline markup.
- Telemetry carries **no** message / prompt / PII content.
- Fork-PR CI stays **secret-free**; never add `pull_request_target`.
- Production SQL is **always** passwordless Entra / Managed Identity; SQL user/password is dev/test only.

## Subsystem map

Deep reference for each subsystem lives in `docs/`. These docs are **not** auto-loaded — read the linked one BEFORE working in that area. The invariants below always apply even when you don't open the doc.

### Auth, teacher roles & student mode → `docs/auth.md`

Read before touching: `auth.ts`, `proxy.ts`, sessions, teacher gating, student mode.

- The app is gated by Microsoft Entra ID (Auth.js v5); the gate is `proxy.ts` at the repo root (Next 16 renamed the `middleware` convention to `proxy`).
- Teacher gating goes through `requireEffectiveTeacher()` (`lib/student-mode.ts`), which honors student mode — see the security block.

### Codes → `docs/codes.md`

Read before touching: `app/page.tsx`, `app/[code]/**`, `app/codes/**`, `app/api/copilotkit/**`, `lib/code-*.ts`, `lib/code-modules/**`, `lib/file-validators.ts`, `lib/quiz-*.ts`, `app/mastra/quiz-agents.ts`, `lib/thread-token.ts`, `novedu_codes`, `novedu_user_chats`.

- Every shareable activity is a `novedu_codes` row reached at `/<code>`; `module` (`tutor` | `quiz` | …) dispatches the renderer/agent. `checkCode()` gates access in **two** sites that must stay in sync: `app/[code]/page.tsx` (a thin dispatcher) and the CopilotKit route (ONE `x-code` header, re-checked on every data request).
- Three layers (see the doc): **FileKind** (`lib/file-name.ts`) → a **validator** keyed by kind (`lib/file-validators.ts`, the single source of truth for "valid? + what metadata", plus the runtime-light `readAnonymousFlag`) → a **CodeModule** descriptor (`lib/code-modules/`) that references a `fileKind` and supplies the runtime agent + stats. Adding a module = a descriptor + registry line + a client label + a render case (+ a validator/`readAnonymousFlag` branch for a new file kind); the generic flow (store, runtime route, stats shell, attribution) is untouched. `fragment` is a validator with **no** module.
- Student thread isolation is the signed `x-thread-token` (`lib/thread-token.ts`) over `(code, userId, threadId)` — Mastra does not bind a thread to its owner, so without the token any code-holder could read another student's chat. The teacher side is **role-gated, not owner-gated**: any effective teacher may view/edit/delete any code. Mastra memory `resourceId` is the code (every module).
- `novedu_user_chats` is the only user↔chat link, written only when the activity opts out of anonymity (default: anonymous, nothing stored). `anonymous` has **two reads**: the frozen row copy governs stats display; the runtime attribution path (`recordUserChat`) reads it **live** from the YAML per file kind.
- Editing a code changes only its note + window — never the module, `file_url`, or the frozen `anonymous`. Deleting a code wipes all its Mastra threads/messages; codes are never garbage-collected, so expired ones still list.
- **Quizzes** are the `quiz` module: a quiz is a `novedu_files` row with `kind: "quiz"` (not structurally validated — save/Validate pass with a warning; `toPublicQuiz` strips the server-only `evaluation` before anything reaches the browser). The runner + in-page modal `<dialog>` discussion live in `app/[code]/_quiz/`; the grader (`quizEvaluator`) stays server-only — see the security block.
- List filtering + multi-delete follow `docs/filtered-lists.md`.

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

### Filtered lists → `docs/filtered-lists.md`

Read before touching: `components/data-list.tsx`, `components/list-filter-bar.tsx`, `components/list-selection.tsx`, `components/selection-column.tsx`, `lib/db/text-filter.ts`, or a list page's `searchParams`.

- List filtering happens in the database, never in memory: filter state lives in URL search params → a parameterized `WHERE` (text via `containsAny`).
- Build a list from the reusable pieces — `DataList` (server table) + `ListFilterBar` (client) — and wrap in `SelectionProvider` + `selectionColumn` + `DeleteSelectedButton` for multi-delete. The async list page needs a sibling `loading.tsx` rendering `<PageLoading>` (`app/page-loading.tsx`).
- Multi-delete reuses the exact same per-item store delete as the per-row trash button (single and bulk share one `DbExecutor` helper; bulk loops it in one transaction). For codes the Mastra thread deletes run per-code outside that transaction (separate pool).
- Aggregated columns are a single raw-SQL aggregate over the filtered set — never a query per row.

### Azure SQL, Drizzle & credentials → `docs/database.md`

Read before touching: Mastra storage (`app/mastra/index.ts`), `lib/db/`, migrations, `instrumentation.ts`.

- Build the SQL connection config via `buildMssqlConnectionConfig()` (`lib/azure-credential.ts`) — the one seam every pool shares. It picks auth from the connection string: SQL auth if it carries `User ID`/`Password`, else passwordless Entra via `buildDataStoreCredential()` (`ChainedTokenCredential(AzureCliCredential, ManagedIdentityCredential)`). Never `DefaultAzureCredential`. (Prod = Entra/MI only — see the security block.)
- `STORAGE_TENANT_ID` is the database's tenant (separate from the sign-in `AZURE_TENANT_ID`).
- App tables use the `novedu_` prefix (`lib/db/schema.ts`), migrated by Drizzle at startup (`npm run db:generate` → commit `drizzle/`). No foreign keys between `novedu_*` and `mastra_*`.

### Telemetry → `docs/telemetry.md`

Read before touching: `instrumentation.ts`, `lib/telemetry.ts`, the `@opentelemetry/*` / `@azure/monitor-opentelemetry` deps, any `recordError` / `emitEvent` call site.

- Telemetry is off unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is set (a secret, never in the repo or CI). Everything goes through the `lib/telemetry.ts` seam; `instrumentation.ts` brings it up before migrations and routes uncaught server errors to `recordError` via `onRequestError`. (No PII — see the security block.)

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
