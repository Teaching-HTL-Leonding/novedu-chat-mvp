# Testing strategy

Deep reference for how this repo is tested. The always-on rule is summarized in
`AGENTS.md`; this file has the full picture. Read it before adding a test,
tagging one `@live`, or changing the CI test jobs.

## Principle

Prefer fast, deterministic, **secret-free** unit/component tests that run in CI.
Reserve full-stack e2e for what genuinely needs the real wired-together app. A
test earns an `@live` tag **only** if its assertion truly needs the live
database, the SCCH LLM, or real Azure Blob Storage — not merely because the code
path happens to sit behind one. If the logic short-circuits before the runtime is
built (the chat gate) or is pure-prop rendering, it belongs in a fast test.

Four kinds of e2e, by the external infra they need:

- **Hermetic e2e** — no external infra (the auth gate, routing, teacher/student
  permissions, client-side validation). Untagged. **Run in CI.**
- **`@live-db` e2e** — need a real SQL Server but NOT the LLM (tutor-code minting,
  file CRUD, the SQL-auth path). **Run in CI** against an ephemeral SQL Server
  service container reached with SQL auth (see "DB-backed `@live-db` in CI" below),
  and locally against real Azure SQL.
- **`@live-llm` e2e** — also need a real LLM endpoint (chat round-trips, vision,
  the health probe, the **quiz** grade-and-discuss flow in `e2e/quiz.spec.ts`,
  the **coding-agent** round-trip in `e2e/coding-agent.spec.ts`, which drives
  the real `pi` coding agent through the public coding endpoint, and the **eval
  judge** probes in `e2e/eval-judge.live.spec.ts` — one test per eval kind (quiz
  feedback, tutor responses), because the one assertion of that feature that cannot be
  faked is whether a real judge flags planted violations and leaves compliant output
  alone, and `evalJudge` has no other real-backend coverage in the repo, unlike the
  grader which `e2e/quiz.spec.ts` smokes indirectly. For the **tutor** kind the judge is
  the only check there is, so a regression means a tutor eval reports nothing at all).
  Neither provider is reachable from CI: the SCCH endpoint is **geo-blocked to
  Austria** and cannot be containerized, and Azure Foundry needs a **Managed
  Identity / `az login`** with the `Cognitive Services OpenAI User` role
  (docs/ai-models.md) — so these are **excluded from CI** and run locally only.
  The Foundry legs (the second `tutor-chat-reply` case, the `health-foundry`
  assertions, the `coding-agent` override case) additionally self-skip when
  `AZURE_FOUNDRY_ENDPOINT` is not set. The judge deliberately has no Foundry leg:
  it resolves its model through the same `resolveLanguageModel` branch the tutor
  leg already drives (see `e2e/eval-judge.live.spec.ts`'s header for what that
  knowingly gives up).
  (Such a test is tagged `@live-llm` ONLY — the DB it also uses is implied — so a
  `--grep @live-db` run never selects it.)
- **`@live-storage` e2e** — need real **Azure Blob Storage** (the image subsystem
  in `e2e/image-management.live.spec.ts`): minting User-Delegation SAS URLs,
  PUT/GET-ing actual blobs, plus the `novedu_images` metadata rows. The storage
  account is reached with the passwordless data-store credential (`az login`) and
  cannot be containerized in fork CI, so these are **excluded from CI** and run
  locally only — exactly like `@live-llm`. (Such a test is tagged `@live-storage`
  ONLY — the DB it also uses is implied — so a `--grep @live-db` run never selects
  it.)

Every live test carries **`@live`** (so the local `--grep @live` smoke runs them
all) **plus exactly one** of `@live-db` / `@live-llm` / `@live-storage`. CI runs
hermetic + `@live-db` and excludes `@live-llm` and `@live-storage` via
`npm run test:e2e:ci` (`--grep-invert "@live-llm|@live-storage"`). Real
credentials (Azure SQL / SCCH / Azure Blob Storage) must never run on a fork
`pull_request`; the CI container's SA password is a non-secret dummy — see
`docs/ci-security.md`.

## Layers & tools

| Layer | Tool (vitest project) | File glob | Env | In CI |
| --- | --- | --- | --- | --- |
| Unit | Vitest `unit` | `**/*.unit.test.{ts,tsx}` | jsdom (or `node` per-file) | ✅ |
| Component | Vitest `component` | `**/*.browser.test.tsx` | Playwright Chromium (real browser) | ✅ |
| CLI unit | Vitest `unit` | `cli/src/**/*.unit.test.ts` | jsdom — colocated, rides the root `unit` glob | ✅ |
| CLI integration | Vitest (`cli/vitest.config.mts`) | `cli/test/*.test.ts` | the built binary + the offline fixtures server | ✅ |
| Hermetic e2e | Playwright | `e2e/*.spec.ts` (untagged) | dev server, no infra | ✅ |
| `@live-db` e2e | Playwright | `e2e/*.spec.ts` tagged `@live-db` | SQL Server (container in CI / Azure SQL local) | ✅ |
| `@live-llm` e2e | Playwright | `e2e/*.spec.ts` tagged `@live-llm` | real DB + SCCH LLM | ❌ local only |
| `@live-storage` e2e | Playwright | `e2e/*.spec.ts` tagged `@live-storage` | real DB + Azure Blob Storage | ❌ local only |

- The `component` project pins **`maxWorkers`** (≤ 4) and its own
  `sequence.groupOrder`. Browser mode's default of `min(12, cpus - 1)` tabs
  saturates the Vite server on a many-core machine until some tester clients
  miss their 60s connect deadline — and a tab lost that way is never failed,
  only waited on, so the run HANGS rather than erroring. Two projects may differ
  in `maxWorkers` only when they sit in different sequence groups, hence the
  explicit order (unit first). The `--maxWorkers` CLI flag does NOT reach the
  browser pool; it reads the project config.
- Config: **`vitest.config.mts`** defines the `unit` + `component` projects;
  **`playwright.config.ts`** the e2e suite (with `e2e/auth.setup.ts` minting
  session cookies — see `docs/auth.md`).
- A unit test that needs Web `fetch` types or to import a server route uses the
  per-file pragma `// @vitest-environment node` (still in the `unit` project).
- The `component` project loads **no global CSS**: tests see the UA stylesheet
  plus inline styles only, which is all a behavioral test needs. A test that
  **measures layout** (sizes, positions, wrapping, overflow) must itself
  `import "@/app/globals.css"` — without it the UA's own rules (e.g.
  `dialog { height: fit-content }`) can satisfy geometry assertions vacuously.
  This stays a per-file opt-in, not a `setupFiles` default: 20+ behavioral
  files don't need it, and Tailwind only generates utilities used in
  `app`/`components` — a class that appears only in a test compiles to
  nothing, so harness geometry uses inline styles (`docs/styling.md`) and a
  global import would not make test-side classes real anyway. Prove any new
  layout assertion is non-vacuous: reintroduce the fault it guards and watch
  it fail (see `tests/component/list-overflow.browser.test.tsx`,
  `dialog-shell.browser.test.tsx`, `image-lightbox.browser.test.tsx`).

## Test fixtures

Tests own their fixtures — **nothing under test reads `activities/`** (that folder
is demo content, free to restructure, and — an accepted trade-off — validated by
no test or CI check; both workflows `paths-ignore` it). Fixtures are deliberately
**synthetic**
(ids like `test-tutor`, content built from `MARKER` strings) so they never read as
real activities. Two homes, by what the layer needs:

- **Inline (unit)** — the `lib/tutors` unit tests (`parse` / `consistency` /
  `assemble` / `fragment` / `load`) share an in-code synthetic tutor + two fragment
  libraries defined as YAML string constants in **`lib/tutors/test-fixtures.ts`**.
  No files, no `node:fs` — the data sits next to the tests.
- **On disk (CLI + e2e)** — **`test-fixtures/activities/{tutors,quizzes,writings,coding}/`**
  holds the minimal synthetic YAML the two layers that genuinely need a file/URL
  use: the CLI (`validate <path>`) and e2e (the app fetches a YAML by URL). See
  `test-fixtures/README.md`.

e2e gets those files over HTTP from a tiny static server, **`test-fixtures/serve.mjs`**,
wired as a **second Playwright `webServer`** — so specs run fully offline (no
GitHub); the dev server fetches the URLs server-side, so `127.0.0.1` resolves.
The fixed port lives in ONE place, `e2e/fixtures.constants.ts`: the Playwright
config health-checks it and passes it to the server's env, and `e2e/code.utils.ts`
builds its URLs from the same constant. The CLI integration test imports
`startFixturesServer` (ephemeral port) for its served-URL cases.

Hermetic fixtures pin a fake **`model: test-model`** (nothing calls an LLM). The
`@live-llm` fixtures — `tutors/live-tutor.yaml`, `tutors/vision-tutor.yaml`,
`writings/test-writing.yaml`, `coding/live-coding.yaml` — carry a **real** model
id because those specs drive the live SCCH endpoint.

## Scripts

| Script | Runs |
| --- | --- |
| `npm run test` | Vitest `unit` + `component` (`test:unit` / `test:component` for one) |
| `npm run test:cli` | Builds the CLI, then its integration suite (`cli/test/*`) |
| `npm run test:e2e` | Playwright, all specs (needs `az login` + `.env` for `@live`) |
| `npm run test:e2e:ci` | Playwright minus `@live-llm` — hermetic + `@live-db` (CI runs this) |
| `npm run test:e2e:db` | Playwright `@live-db` only (against a local SQL Server container) |
| `npm run qa` | `check` + `typecheck` + `test` + `test:cli` + `build` + `docs:build` (`qa:e2e` adds e2e) |

Run the local-only smoke (with `az login` done and `.env` populated):

```
npm run test:e2e -- --grep @live
```

The kept `@live` set is deliberately small. The **`@live-db`** ones — a valid code
opens the chat, a mid-session window-close keeps the chat on screen, a teacher
creating a code, the file CRUD lifecycle plus the list **multi-delete** ("Delete
Selected" over several files) (`e2e/file-and-tutor-code-crud.spec.ts`, which writes
the real `novedu_files` table), and the **database auth-matrix**
(`e2e/db-auth.live.spec.ts`, below) — also run **in CI** against a container (next
section). The **`@live-llm`** ones — the text round-trip, the vision round-trip,
the health probe, the coding-agent round-trip, the eval feedback-judge probes — stay
**local** (the SCCH endpoint is geo-blocked to Austria), as does the
**reasoning-visibility** set (`e2e/reasoning-visibility.spec.ts`): it reads the
raw `/api/copilotkit` SSE bodies to prove an effective teacher receives
`REASONING_*` frames while a teacher in view-as-student mode and a real student
receive **zero**,
which only a real reasoning model can produce. Because that spec cannot run in
CI, the property's actual CI guard is the hermetic set: the runner (including the
`AgentRunner` method-list guard), the route's runner choice, and the persistence
processor — `app/api/copilotkit/reasoning-runner.unit.test.ts`,
`app/api/copilotkit/[[...slug]]/route.unit.test.ts`,
`app/mastra/reasoning-processor.unit.test.ts` — see `docs/chat.md`.

The shared list **multi-delete** layer's pure interaction (checkboxes, select-all,
the confirm/spinner/clear flow over a mocked action) is a fast **component** test —
`tests/component/list-selection.browser.test.tsx` — not an `@live` one; only the
wired DB delete needs the container.

## DB-backed `@live-db` in CI (SQL Server container)

The `@live-db` tests run on every PR (QA) and on `main` (CD) with **no secret**.
The `e2e` job in `.github/workflows/qa.yml` (reused by `docker-publish.yml`, so one
change covers both) starts an **ephemeral SQL Server 2022 service container** and
connects with **SQL auth** — the container's SA password is a non-secret DUMMY
literal, so secret-freeness / fork-safety holds (`docs/ci-security.md`).

Flow: the service container starts → `scripts/ci/wait-and-create-db.mjs` polls for
readiness and runs `CREATE DATABASE` (the app migrates *tables* on boot but never
creates the database) → `npm run test:e2e:ci` runs hermetic + `@live-db`; the
Playwright `webServer` boots `npm run dev`, which applies the `novedu_*` migrations
and lets Mastra auto-create `mastra_*`. SCCH is intentionally unset — the app boots
without models and the DB-only specs never call the LLM. The `db-auth` Entra test
detects the SQL-auth string and **skips** in CI; its SQL-auth half runs against the
container.

Reproduce it locally against a throwaway container:

```
docker run -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='Test-Passw0rd!' -p 1433:1433 \
  -d mcr.microsoft.com/mssql/server:2022-latest
export MSSQL_CONNECTION_STRING='Server=tcp:localhost,1433;Initial Catalog=noveduTest;Encrypt=False;User ID=sa;Password=Test-Passw0rd!;'
export MSSQL_SQLAUTH_CONNECTION_STRING="$MSSQL_CONNECTION_STRING"
node scripts/ci/wait-and-create-db.mjs
npm run test:e2e:db
```

## Database auth-matrix `@live` test

`buildMssqlConnectionConfig()` (the one auth seam, see `docs/database.md`)
supports two ways to reach Azure SQL: passwordless **Entra ID** (production) and
classic **SQL user/password** (a **dev/test-only** fallback — never prod; full
policy in `docs/database.md`). `e2e/db-auth.live.spec.ts` proves BOTH connect
end-to-end: it builds a pool through the real seam, asserts the chosen auth
*mode*, and queries `SUSER_SNAME()` to confirm *which* principal authenticated
(so the two paths can't silently collapse into one). The fast, secret-free
companion that locks down the branch *selection* is
`lib/azure-credential.unit.test.ts`.

The two halves use two env vars and degrade independently:

- **Entra** uses `MSSQL_CONNECTION_STRING` (already required for any `@live` run).
- **SQL auth** uses `MSSQL_SQLAUTH_CONNECTION_STRING` — a `User ID=...;Password=...`
  string. **Locally** it points at the same Azure SQL DB via a real SQL login, so
  it is a **secret** (local `.env` only). **In CI** it points at the ephemeral
  container (a non-secret dummy). When it is unset the SQL-auth test **skips** (the
  suite still passes), so no one needs a SQL login to keep the suite green.

Provision the SQL login once (any `db_owner`/AAD-admin can, via `sqlcmd`
authenticated with `az login`), then drop the connection string into `.env`:

```sql
-- contained SQL user in the app database (Azure SQL Database)
CREATE USER [novedu_sqlauth] WITH PASSWORD = '<strong-password>';
ALTER ROLE db_datareader ADD MEMBER [novedu_sqlauth];
ALTER ROLE db_datawriter ADD MEMBER [novedu_sqlauth];
```

```
# .env (gitignored, local only) — same server/db as MSSQL_CONNECTION_STRING
MSSQL_SQLAUTH_CONNECTION_STRING=Server=tcp:<server>.database.windows.net,1433;Initial Catalog=<db>;Encrypt=True;User ID=novedu_sqlauth;Password=<strong-password>;
```

Run just this spec (both modes) with: `npm run test:e2e -- e2e/db-auth.live.spec.ts`.

## Testing the chat gate and server components WITHOUT infra

The chat runtime route and the chat page consume security-critical inputs but
their decisions are fast to test — the gate returns 401/403/404 before any
runtime is built, and the page maps a check result to a view. The pattern (see
`app/api/copilotkit/[[...slug]]/route.unit.test.ts` and
`app/[code]/page.unit.test.tsx`):

1. `// @vitest-environment node`.
2. `vi.mock` the I/O seams — `@/auth`, the `novedu_*` stores, `@/app/mastra`,
   and (past the gate) the CopilotKit runtime / Mastra agent factory.
3. Keep the **security-critical pure module REAL** — e.g. `lib/thread-token.ts`
   (the HMAC), so the test exercises the actual check, not a stub of it.
4. Drive real `Request` objects through the exported handler, or call the
   `async` server component directly and render its element with
   `renderToStaticMarkup`; assert status / JSON / HTML.

This is how the thread-ownership, window-enforcement, and rejection-rendering
behaviors run in CI without infra.

## CI

`.github/workflows/qa.yml` runs `check` → `typecheck` → `test:unit` →
`test:component` → `test:cli` → `build`, plus a separate hermetic e2e job (`test:e2e:ci`) and a
PR-only `prod-build` job that builds the production Docker image (no push). Every
job is **secret-free**; that is a hard security invariant, not a convenience — see
**`docs/ci-security.md`**.

## Subsystem specifics

- **Tutor codes / the chat gate** → `docs/codes.md` (Testing section).
- **Auth & e2e session cookies** → `docs/auth.md`.
