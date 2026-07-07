# CLI / API bearer authentication & management API

Deep reference for the app's second auth channel: CLI commands (and any other
non-browser client, e.g. a future MCP server) calling app API routes with an
Entra **bearer token** instead of a session cookie. Read it before touching
`lib/api-auth.ts`, `app/api/me/**`, `app/api/codes/**`, `app/api/files/**`
(the bearer handlers), the services they share with the web actions
(`lib/code-service.ts`, `lib/file-service.ts`), the CLI commands
(`cli/src/auth.ts`, `cli/src/api.ts`,
`cli/src/commands/{login,logout,whoami,codes,files}.ts`), or when adding a
bearer-protected endpoint. Cookie sessions, teacher roles and student mode
live in `docs/auth.md`.

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
  with a `WWW-Authenticate: Bearer` header and the generic body — validation
  detail never reaches the client.

## Routes & conventions

Shared conventions: every handler is `force-dynamic`, answers
`Cache-Control: no-store`, returns the generic 401/403 body with
`WWW-Authenticate: Bearer` on an `ApiAuthError`, and maps store-level DB
failures (`undefined` returns) to `503 { message }`. Failure bodies are
`{ message }` or `{ errors: ValidationError[] }` — the identical structured
detail the web forms render. All timestamps are ISO 8601 UTC or `null`; every
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
- **Proxy exclusion, per route:** bearer routes must not hit the cookie gate
  (a CLI has no session), so each one gets its own **path-bounded** entry in
  the `proxy.ts` matcher (`api/me(?:/|$)`, `api/codes(?:/|$)`) — never a
  blanket `/api` prefix. The files handlers ride the pre-existing public
  `api/files` exclusion and self-gate. Adding a bearer endpoint = new route
  file gated by `requireBearerUser`/`requireBearerTeacher` + its own matcher
  exclusion + documentation here.
- **The service seam:** the bearer write routes and the web server actions
  execute the identical policy pipeline through `lib/code-service.ts` /
  `lib/file-service.ts` (plain server modules; auth never enters them — each
  channel gates itself and passes the verified `userId` in). Listing needs no
  service: `listCodes` / `listFiles` are already transport-agnostic.

## CLI: `cli/src/auth.ts` + commands

- `@azure/msal-node` (pure JS; requires Node ≥ 20 — the package `engines`
  reflect that). Tenant and client id are baked-in public identifiers,
  overridable via `NOVEDU_TENANT_ID` / `NOVEDU_CLIENT_ID` for other
  deployments of this teaching repo. Requested scope:
  `api://<client-id>/cli.access` (msal-node adds the OIDC scopes itself).
- **Management commands** (`cli/src/commands/codes.ts`, `files.ts`; shared
  plumbing in `cli/src/api.ts`): `codes create/list`, `files upload/list` —
  thin flag→request mappers over the routes above, **JSON-only** output:
  success bodies pretty-printed on **stdout** (exit 0), every failure — auth,
  network, or the server's `{ message }`/`{ errors }` verbatim — as JSON on
  **stderr** (exit 1); both streams are jq-processable. `files upload <name>`
  reads YAML from `--file <path>` or stdin; `list` defaults to only-mine
  (`--all` widens, UI parity). No client-side pre-validation — the server runs
  the identical pipeline; offline checking stays the `validate` command's job.
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
  `Not signed in — run "novedu-cli login".`, exit 1.

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
  `app/api/files/[name]/route.unit.test.ts`) keep the auth gate REAL the same
  way (local JWKS, minted tokens) and mock the services/stores: the 401/403
  matrix, filter parsing + the `mine` default, naive-timestamp rejection, the
  400/409/503 mapping, and the wire shapes.
- **e2e:** `e2e/api-auth.setup.ts` generates the keypair once into the
  gitignored `e2e/.auth/` (once, not per run — the server caches the JWKS
  after the first bearer request); `playwright.config.ts` injects
  `API_AUTH_JWKS_PATH` into the dev-server env; `e2e/api-me.spec.ts` and
  `e2e/api-codes.spec.ts` exercise the routes over HTTP with an empty cookie
  state, which also proves the proxy-matcher exclusions (a regression turns
  the expected 401 into a sign-in redirect); the @live-db
  `e2e/api-management.live.spec.ts` runs the full file-upsert → list →
  code-create → list lifecycle against the real database. Local caveat: a
  reused dev server started without the env var fails these specs — restart
  it with the var or let Playwright start its own.
- **CLI unit tests** mock `@azure/msal-node` and `fetch`; the cache plugin is
  tested against the real filesystem (permission modes included). The
  `codes`/`files` command tests pin the flag→request mapping, stdin/--file
  reading, and the stdout/stderr JSON split.
