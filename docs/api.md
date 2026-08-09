# CLI / API bearer authentication & management API

Deep reference for the app's second auth channel: CLI commands (and any other
non-browser client, e.g. a future MCP server) calling app API routes with an
Entra **bearer token** instead of a session cookie. Read it before touching
`lib/api-auth.ts`, `app/api/me/**`, `app/api/codes/**`, `app/api/files/**`
(the bearer handlers), `app/api/images/**`, `app/api/reports/**`,
`app/api/eval/**`, the services
they share with the web actions (`lib/code-service.ts`, `lib/file-service.ts`,
`lib/image-service.ts`), the CLI commands (`cli/src/auth.ts`, `cli/src/api.ts`,
`cli/src/commands/{login,logout,whoami,codes,files,images,reports,eval}.ts`), or when
adding a bearer-protected endpoint. Cookie sessions, teacher roles and student
mode live in `docs/auth.md`.

## The model

The CLI is a **public client of the same "Novedu Chat MVP" app registration**
the web app signs in with. It requests tokens for the app's own exposed
delegated scope and sends them as `Authorization: Bearer` headers. The server
validates each token cryptographically against the tenant's published keys —
no session, no cookie, no server-side login state.

- One human-assisted `novedu-cli login` caches a refresh token; every later
  command acquires access tokens silently. The primary CLI user is a coding
  agent (see `.claude/skills/novedu-tutor-cli`), so non-interactive operation
  after the single login is a design requirement.
- **Student mode does not exist on the bearer path** (it is a cookie): the
  token always reflects the caller's real role.
- `logout` is purely local (cache removal); issued access tokens stay valid
  until expiry (~1 h). Acceptable for this teaching context.

## Entra configuration (record)

App registration **Novedu Chat MVP**, client id
`4d44fc4b-0434-4981-9765-62e2074ceecb`, in the login tenant (`AZURE_TENANT_ID`).
Configured in the portal by the tenant admin:

- **Application ID URI** `api://4d44fc4b-0434-4981-9765-62e2074ceecb` with the
  delegated scope **`cli.access`** (id `5144d598-d08d-4563-81b9-2fa52d15da19`,
  "Admins and users" may consent).
- **`requestedAccessTokenVersion: 2`** — access tokens are v2 with issuer
  `https://login.microsoftonline.com/<tenant>/v2.0` (the same issuer `auth.ts`
  trusts) and the client-id GUID as audience.
- **Public client flow enabled** (`isFallbackPublicClient`) with the
  **`http://localhost` redirect URI** (Entra matches any localhost port) for
  the CLI's loopback sign-in; the `groups` optional claim is emitted into
  **access tokens** (`groupMembershipClaims: All`), so the teacher role is
  derivable server-side.
- **Consent is per-user:** no tenant-wide admin grant. Each user sees a one-time
  consent prompt for `cli.access` during their first device-code login.

## Server: `lib/api-auth.ts` — the one seam

Every bearer route gates itself through this module and nothing else (the
analogue of `checkCode()` for codes):

- **`requireBearerUser(request)`** validates the `Authorization: Bearer` JWT:
  signature via the tenant JWKS
  (`https://login.microsoftonline.com/<AZURE_TENANT_ID>/discovery/v2.0/keys`,
  jose `createRemoteJWKSet` — key caching built in), issuer (v2.0), audience
  (`AZURE_CLIENT_ID`), expiry, `scp` containing `cli.access`, and a non-empty
  `oid`. Returns `{ userId, name, isTeacher }` where `userId` is the **`oid`**
  claim (the app-wide stable user key — never `sub`, see `docs/auth.md`) and
  `isTeacher` comes from the token's `groups` claim via the same
  `resolveTeacher` (`lib/teacher.ts`) used at sign-in; a groups **overage fails
  closed** (not a teacher).
- **`requireBearerTeacher(request)`** additionally requires the teacher role —
  the gate for teacher-only endpoints.
- Every rejection throws a typed **`ApiAuthError`** (`status` 401 or 403) with
  a deliberately generic message; the underlying jose reason goes to telemetry
  (`recordError`, never token content). Route handlers return the error status
  with a `WWW-Authenticate: Bearer` header and the generic
  `{ message: "Unauthorized" | "Forbidden" }` body — the same `{ message }` key
  as every other failure on this channel; validation detail never reaches the
  client.

## Routes & conventions

Shared conventions: every handler is `force-dynamic`, answers
`Cache-Control: no-store`, and maps store-level DB failures (`undefined`
returns) to `503 { message }`. EVERY failure body on this channel — including
the generic 401/403 (sent with `WWW-Authenticate: Bearer` on an
`ApiAuthError`) and the 500 fallback — is `{ message }` or
`{ errors: ValidationError[] }` (the identical structured detail the web forms
render); there is no third key for scripts to probe. All timestamps are ISO 8601 UTC or `null`; every
`url` field is built from the request-time `resolveAppOrigin()` (never the
stored `origin` column, which is operator-only).

- **`GET /api/me`** (`app/api/me/route.ts`) — the identity probe backing
  `novedu-cli whoami`: any valid token gets
  `{ name, userId, isTeacher }` (it reports the teacher flag rather than
  requiring it — a diagnostic for misconfigured accounts).
- **`GET /api/codes?q=&mine=&module=`** (`app/api/codes/route.ts`,
  teacher-only) — the `/codes` page's exact filters and defaults: `q`
  contains-matches note/code, `mine` defaults **on** (`mine=0` widens to all
  teachers; `createdBy` = the token `oid`), `module` optional. Bare JSON
  array, newest first, of
  `{ code, url, module, note, fileUrl, anonymous, validFrom, validUntil, llm, createdBy, createdAt }`
  (`url` the shareable link, `llm` the override pair or `null`).
- **`POST /api/codes`** (same file, teacher-only) — mints a code through the
  SAME pipeline as the web form (`createCodeForUser`,
  `lib/code-service.ts`). JSON body
  `{ module, fileUrl, validFrom?, validUntil?, note?, llm?: { provider, model } }`;
  the window bounds must be ISO 8601 **with an explicit offset or `Z`** — a
  naive datetime is rejected with 400 (it would otherwise silently be
  interpreted in the server's timezone). `201` + the same code object shape.
- **`GET /api/files?q=&mine=`** (`app/api/files/route.ts`, teacher-only) —
  the `/files` page's filters and defaults (`q` over
  name/title/description; `mine` default on). Bare JSON array of active
  versions **without content**:
  `{ name, kind, title, description, createdBy, createdAt, url }` (`url` the
  public download URL; download itself needs nothing new — the per-name GET
  is public).
- **`PUT /api/files/<name>`** (`app/api/files/[name]/route.ts`, teacher-only;
  the GET on the same URL stays public) — **upsert** via `upsertFileForUser`
  (`lib/file-service.ts`): create if the name is free (`kind` then required —
  a missing one fails naming the five kinds), else a new version validated
  against the **stored** kind; a supplied `kind` that mismatches the stored
  one fails **loudly** with `409` (never silently ignored; a create race on
  the name is 409 too). Body `{ kind?, content }`; `200` with
  `{ name, kind, url, action: "created" | "updated" }`.
- **`GET /api/images?q=&mine=`** (`app/api/images/route.ts`, teacher-only) —
  the `/images` page's filters and defaults (`q` over the name; `mine` default
  on). Bare JSON array of active versions
  `{ name, mimeType, byteSize, credit, createdBy, createdAt, url }` — `url` is
  a **short-lived (~3 h) read SAS** straight to the blob (the bytes never pass
  through the app, `docs/images.md`), or `null` when minting fails for that
  row. Unlike `/api/files` there is **no public GET** anywhere under this
  prefix.
- **`POST /api/images/<name>`** (`app/api/images/[name]/route.ts`,
  teacher-only) — step 1 of the same **confirm-only, direct-to-blob** upload
  flow the web form uses, via `prepareImageUpload` (`lib/image-service.ts`).
  Body `{ mime, byteSize }` (PNG/JPEG/SVG, ≤ 5 MB — the claimed size; confirm
  re-derives the real one). `200` with `{ uploadUrl, blobPath }`: PUT the raw
  bytes to `uploadUrl` with `x-ms-blob-type: BlockBlob` and a `Content-Type`
  equal to `mime` (the create-only SAS pins it, valid ~10 min), then confirm.
  **Create-only, no upsert** — images are immutable; a taken name is `409`
  (delete + re-upload in the web app is the way to replace one). Writes no DB
  row.
- **`POST /api/images/<name>/confirm`**
  (`app/api/images/[name]/confirm/route.ts`, teacher-only) — step 3:
  `confirmImageUploadForUser` (`lib/image-service.ts`) inspects the landed blob
  (size/MIME re-derived, never trusted from the client; a present-but-bad blob
  is deleted best-effort) and writes the `novedu_images` row as the token
  `oid`. Body `{ blobPath, mime, credit? }` (`credit` trimmed, clamped to 512
  chars). `201` with `{ name, mimeType, byteSize, credit }`; a missing or
  off-policy blob is `400`, a name race `409`, storage trouble `503`.
- **`GET /api/reports?status=&reaction=&q=&mine=`** (`app/api/reports/route.ts`,
  teacher-only) — the `/reports` inbox's exact filters and defaults over
  `listReports`: `status` `open` (default) | `resolved` | `all`; `reaction` one
  of `good` | `omg` | `bad` | `holysh` (optional); `q` the inbox's DB-side
  contains-search (description, reporter oid + display name, code, code note);
  `mine` defaults **on** (`mine=0` widens to all teachers; `codeCreatedBy` = the
  token `oid`). An unknown `status` or `reaction` is rejected **`400 { message }`**
  — scripts fail loudly where the forgiving web UI silently ignores. Bare JSON
  array in the inbox order (open `holysh` first, then newest first) of the full
  `ReportListRow` parity shape
  `{ id, kind, code, codeNote, userId, displayName, reaction, description, createdAt, threadId, questionId, questionText, answerText, feedbackText, verdict, hadImages, resolvedAt, resolvedBy }`.
  The report is explicitly non-anonymous toward teachers (the sanctioned waiver,
  `docs/reports.md`); `codeNote`/`displayName` are `null` for a deleted code /
  unknown user, the quiz-only snapshot columns `null` for a chat report and the
  chat-only `threadId` `null` for a quiz report.
- **`GET /api/reports/<id>`** (`app/api/reports/[id]/route.ts`, teacher-only) —
  the same report object for one id (`getReportById`, the single-row twin of
  `listReports`). For `kind: "chat"` it additionally embeds the transcript:
  `{ …report fields…, messages: [{ id, role, content }] }` from
  `getConversationMessages(code, threadId)` (`lib/code-stats-store.ts`, the same
  collapsed sequence the web transcript page renders; text messages only). A
  quiz-answer report has **no** `messages` key — its snapshot is already on the
  row. A malformed (non-UUID) or unknown id → **`404 { message }`**; a chat
  report whose code/thread was deleted returns `messages: []` (the report itself
  still shows); a store/transcript DB error → `503`.
- **`POST /api/reports/resolve`** (`app/api/reports/resolve/route.ts`,
  teacher-only) — bulk resolve by id. JSON body `{ ids: ["<uuid>", …] }` —
  non-empty, every entry UUID-shaped (the web bulk actions' guard); anything
  else → **`400 { message }`**. Stamps `resolved_at = now` + `resolved_by` = the
  token `oid` via `setReportsResolved(ids, true, oid)`; unknown / already-resolved
  ids are silent no-ops (the blanket update). `200` with `{ ok: true }`; store
  failure → `503`. **Resolve is the only mutation on this channel — reopen and
  delete stay web-only** (an agent should never destroy a student's report;
  `docs/reports.md`).
- **`POST /api/eval/grade`** (`app/api/eval/grade/route.ts`, teacher-only) — grades
  ONE golden answer for `novedu-cli eval` (`docs/cli-eval.md`). Body
  `{ llm: { provider?, model }, system, answer }` (`provider` defaults to SCCH; an
  unknown one is `400`, never silently defaulted); `200` with
  `{ result: "correct" | "partial" | "incorrect", feedback, usage? }`, the OPTIONAL
  `usage: { input, cachedInput, output }` carrying this call's tokens when the model
  reported any (`input` includes the cached part; the field is omitted entirely when
  there is no usage — `docs/cli-eval.md`). It runs the **exact**
  production grading path — the memory-less `quizEvaluator` with
  `QUIZ_VERDICT_SCHEMA` structured output over `buildAnswerMessage(answer.trim())`,
  the same call `submitAnswer` makes — and **persists nothing** (no queue, no run
  history: one request = one graded answer, so the CLI can fan out and retry).
  Failures: `400` for a malformed body, an unknown provider, a provider this
  deployment cannot serve (`providerUnavailableReason` — deliberately terminal so
  the CLI does not retry it), or an answer that is empty after trimming; `413` above
  the **256 KB** body cap; `401`/`403` from the bearer gate; `502` when the grader
  throws or returns no structured object. Stated plainly: this is a **teacher-scoped,
  verdict-schema-constrained LLM pass-through** — a teacher may send arbitrary
  `system`/`answer` text through it. That is a deliberate property under this repo's
  trust model (teachers already author every activity prompt), and it is why the
  gate is `requireBearerTeacher` and the grading prompt comes from the client so the
  server-held quiz `evaluation` prompts never leave the server. Usage is metered
  under the `cli-eval` pseudo-code + `eval` module (`docs/usage-metering.md`).
- **Proxy exclusion, per route:** bearer routes must not hit the cookie gate
  (a CLI has no session), so each one gets its own **path-bounded** entry in
  the `proxy.ts` matcher (`api/me(?:/|$)`, `api/codes(?:/|$)`,
  `api/reports(?:/|$)`, `api/images(?:/|$)`, `api/eval(?:/|$)`) — never a blanket `/api` prefix. The files handlers ride
  the pre-existing public `api/files` exclusion and self-gate. Adding a bearer endpoint = new route
  file gated by `requireBearerUser`/`requireBearerTeacher` + its own matcher
  exclusion + documentation here.
- **The service seam:** the bearer write routes and the web server actions
  execute the identical policy pipeline through `lib/code-service.ts` /
  `lib/file-service.ts` / `lib/image-service.ts` (plain server modules; auth
  never enters them — each channel gates itself and passes the verified
  `userId` in). Listing needs no
  service: `listCodes` / `listFiles` / `listImages` are already transport-agnostic, and every
  `reports` operation is likewise a bare `lib/report-store.ts` call (the added
  `getReportById` plus the existing `listReports` / `setReportsResolved`) — no
  service layer, auth never enters the store.

## CLI: `cli/src/auth.ts` + commands

- `@azure/msal-node` (pure JS; requires Node ≥ 20 — the package `engines`
  reflect that). Tenant and client id are baked-in public identifiers,
  overridable via `NOVEDU_TENANT_ID` / `NOVEDU_CLIENT_ID` for other
  deployments of this teaching repo. Requested scope:
  `api://<client-id>/cli.access` (msal-node adds the OIDC scopes itself).
- **Management commands** (`cli/src/commands/codes.ts`, `files.ts`,
  `images.ts`, `reports.ts`; shared plumbing in `cli/src/api.ts`):
  `codes create/list`, `files upload/list`, `images upload/list`,
  `reports list/show/resolve` — thin flag→request mappers
  over the routes above, **JSON-only** output: success bodies pretty-printed on
  **stdout** (exit 0), every failure — auth, network, or the server's
  `{ message }`/`{ errors }` verbatim — as JSON on **stderr** (exit 1); both
  streams are jq-processable. `files upload <name>` reads YAML from
  `--file <path>` or stdin; `list` defaults to only-mine (`--all` widens, UI
  parity). No client-side pre-validation — the server runs the identical
  pipeline; offline checking stays the `validate` command's job.
- **`codes sync <registry-file>`** is the ONE exception to the JSON-only output
  rule: it reconciles a whole **activity registry** (`docs/registry.md`) in a
  single run — one `GET /api/codes`, then a `POST /api/codes` per entry that has
  no matching code — so it prints a per-entry report and keeps the JSON contract
  behind `--json`. It adds no route and no server behavior: matching is entirely
  client-side over the listing's `fileUrl` / `module` / window / `llm` fields.
  Hard failures (invalid registry, no token, unreachable server, unwritable
  lock) stay JSON on stderr with exit 1; a single entry's rejection is reported
  in the run's report instead — `performApiRequest({ quiet: true })` hands the
  failure payload back rather than printing it.
- **The `images` group** (`cli/src/commands/images.ts`) drives the three
  `/api/images` routes. `images upload <name> --file <path> [--credit <text>]`
  runs the 3-step flow client-side: bearer `POST /api/images/<name>` for the
  slot, a **raw `PUT` of the bytes to the SAS `uploadUrl`** (no bearer header —
  the SAS is the auth; `Content-Type` = the MIME derived from the file
  extension via the shared `imageMimeFromExtension`, the one client-side
  check because the SAS pins it), then bearer `POST …/confirm` whose body is
  the command's stdout. `--file` is **required** (binary — no stdin);
  whichever step fails, exactly one JSON error lands on stderr (exit 1) and
  later steps are skipped. `images list [--search <q>] [--all]` mirrors
  `files list`. Create-only like the route: no overwrite, no delete (web-only).
- **The `reports` group** (`cli/src/commands/reports.ts`) drives the three
  `/api/reports` routes for the report-triage loop
  (`reports list` → `reports show <id>` → fix the activity YAML →
  `files upload` → `reports resolve <id…>`; `docs/reports.md`):
  `reports list [--status <open|resolved|all>] [--reaction <good|omg|bad|holysh>] [--search <q>] [--all]`
  (defaults to **open** reports on **my** codes, `--all` → `mine=0`, `--search`
  → `q`, `--status`/`--reaction` pass through verbatim — the server rejects
  unknown values, no client-side enum check); `reports show <id>` prints the
  single report, transcript embedded for a chat report so an agent gets
  everything in one call; `reports resolve <id…>` sends every id in one
  `POST /api/reports/resolve`. Reopen and delete are deliberately **not** here —
  they stay web-only.
- **`eval <evalPathOrUrl…>`** (`cli/src/commands/eval.ts`) is the second exception
  to the JSON-only rule, for the same reason as `codes sync`: it makes MANY requests
  (one `POST /api/eval/grade` per golden answer × `--repeats`, bounded by
  `--concurrency`) and prints a run report, keeping the machine-readable batch shape
  behind `--json` / `--out`. It is the first command that both talks to the server
  and does substantial offline work: the grading prompts are assembled locally
  through the app's own dump seam. Per-case failures are handled by the command
  (`performApiRequest({ quiet: true })` + the new `status` / `authFailed` markers:
  retry 5xx and network, abort the whole run on 401/403); hard failures — no usable
  eval file, half an `--llm-*` pair, an unwritable `--out` — stay JSON on stderr with
  exit 1. See `docs/cli-eval.md`.
- **Token cache** `~/.novedu/token-cache.json` — plain JSON via an MSAL
  `ICachePlugin` (az-CLI model), directory `0700`, file `0600`. It holds the
  refresh token; treat it like a credential.
- **`login`** tries silent acquisition first (`Already signed in as …`, exit 0
  — an agent re-running it never blocks), else runs the interactive
  **authorization-code + PKCE flow with a loopback redirect** (opens the
  system browser; the az-CLI model). `login --device-code` uses the device
  code flow instead — needed on browserless machines, but tenants commonly
  **block it by Conditional Access policy** (error 53003; the HTBLA tenant
  does), which is why the browser flow is the default. **`logout`** removes
  the cached accounts and deletes the cache file (idempotent). **`whoami`**
  calls `GET <server>/api/me` — server base from `--server`, then
  `NOVEDU_SERVER`, then the production default (`cli/src/server-url.ts`).
- Not-signed-in state is the typed `NotSignedInError` →
  `Not signed in — run "novedu-cli login".`, exit 1. `performApiRequest` reports it
  back as a failure carrying `authFailed: true` (and NO `status`, since nothing was
  sent), alongside the HTTP `status` it sets on a non-2xx — the two markers a
  many-request command needs to tell "retry", "give up on this item" and "abort the
  whole run" apart.

## Testing (hermetic; validation stays real)

The JWKS source honors a **test-only** override: `API_AUTH_JWKS_PATH` (a local
JWKS JSON file), applied **only when `NODE_ENV !== "production"`** so a stray
env var can never weaken a real deployment. Issuer and audience are NOT
overridable — tests mint tokens carrying the real env values and substitute
only the signing key (the same strategy as the e2e session-cookie minting).

- **Unit:** `lib/api-auth.unit.test.ts` generates a keypair and runs the full
  verdict matrix (signature, issuer, audience, expiry, scope, oid, teacher
  groups, overage) through the REAL `jwtVerify`.
- **Route unit tests** (`app/api/codes/route.unit.test.ts`,
  `app/api/files/route.unit.test.ts`, the PUT cases in
  `app/api/files/[name]/route.unit.test.ts`, the three images routes —
  `app/api/images/route.unit.test.ts`,
  `app/api/images/[name]/route.unit.test.ts`,
  `app/api/images/[name]/confirm/route.unit.test.ts` — and the three reports
  routes — `app/api/reports/route.unit.test.ts`,
  `app/api/reports/[id]/route.unit.test.ts`,
  `app/api/reports/resolve/route.unit.test.ts`) keep the auth gate REAL the same
  way (local JWKS, minted tokens) and mock the services/stores: the 401/403
  matrix, filter parsing + the `mine` default, naive-timestamp rejection, the
  400/409/503 mapping, and the wire shapes. The reports specs additionally mock
  `lib/report-store` + `getConversationMessages` and assert the 400 on unknown
  enum values / malformed `ids`, the 404 cases, the chat-embeds-`messages` /
  quiz-doesn't / deleted-code → `[]` shapes, and that resolve passes the token
  `oid` as `teacherId`. `app/api/eval/grade/route.unit.test.ts` keeps the gate real
  the same way and mocks `@/app/mastra` (like `lib/quiz-actions.unit.test.ts`): the
  401/403 matrix, the 400 matrix (bad body, unknown provider, unavailable provider,
  empty-after-trim answer), the 413 cap, the 200 wire shape, the 502s, and — the
  production-parity assertion — that the agent receives `buildAnswerMessage` of the
  TRIMMED answer plus the `QUIZ_EVAL_*` and usage-sentinel RequestContext values.
- **e2e:** `e2e/api-auth.setup.ts` generates the keypair once into the
  gitignored `e2e/.auth/` (once, not per run — the server caches the JWKS
  after the first bearer request); `playwright.config.ts` injects
  `API_AUTH_JWKS_PATH` into the dev-server env; `e2e/api-me.spec.ts`,
  `e2e/api-codes.spec.ts`, `e2e/api-images.spec.ts` and `e2e/api-reports.spec.ts`
  exercise the routes over
  HTTP with an empty cookie state, which also proves the proxy-matcher
  exclusions (a regression turns the expected 401 into a sign-in redirect); the
  @live-db `e2e/api-management.live.spec.ts` runs the full file-upsert → list →
  code-create → list lifecycle against the real database, and the @live-db
  `e2e/api-reports.live.spec.ts` files a chat report through the real UI (a
  zero-message thread, no LLM) then drives `GET /api/reports` → `GET
  /api/reports/<id>` (with `messages`) → `POST /api/reports/resolve` → the
  `status=resolved` listing. Local caveat: a reused dev server started without
  the env var fails these specs — restart it with the var or let Playwright
  start its own.
- **CLI unit tests** mock `@azure/msal-node` and `fetch`; the cache plugin is
  tested against the real filesystem (permission modes included). `codes sync`
  additionally has offline integration coverage against a fake `/api/codes` in
  `test-fixtures/serve.mjs`, reached with the **test-only `NOVEDU_TOKEN`**
  override in `cli/src/auth.ts` (checked before the MSAL cache — it only skips
  the interactive login; the server still validates the token on every request).
  See `docs/registry.md`. The
  `codes`/`files` command tests pin the flag→request mapping, stdin/--file
  reading, and the stdout/stderr JSON split; `cli/src/commands/reports.unit.test.ts`
  does the same for `reports list/show/resolve` (the defaults, `--all` →
  `mine=0`, the multi-id resolve body, and the exit codes), and
  `cli/src/commands/images.unit.test.ts` pins the 3-step upload order (raw SAS
  PUT with the pinned content type and NO bearer header), the short-circuit on
  each step's failure, and the extension→MIME rejection with zero fetches.
