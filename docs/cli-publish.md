# Publishing the `@novedu/cli` npm package

The CLI (`cli/` workspace, installed command `novedu-cli`) is published to npm as
the **public scoped package `@novedu/cli`**. This doc covers how it is published:
the one-time manual bootstrap, the npmjs.com trusted-publisher setup, and the
normal tag-driven CI release flow.

> TL;DR for a routine release: bump `cli/package.json` "version" via a PR, merge
> to `main`, then `git tag cli-v<version> && git push origin cli-v<version>`.
> The `publish-cli.yml` workflow does the rest (OIDC, no secret).

## Package facts

- **Name:** `@novedu/cli` (scoped, `publishConfig.access: public`).
- **Bin:** `novedu-cli` → `dist/main.js`. **Published files:** `dist/` only
  (`files: ["dist"]`), plus `package.json` + `README.md`. Source/tests/configs
  never ship.
- **Build:** `tsdown` (`npm run cli:build`). `cli/dist/` is **gitignored**, so it
  must be (re)built right before every publish. A `prepublishOnly: npm run build`
  script enforces this so a stale/missing `dist` can never be published — manual
  or CI.
- **`repository` field is mandatory** (see [Provenance](#provenance-required)).

## How auth works: trusted publishing (OIDC), not a token

Releases use npm **Trusted Publishing**: GitHub Actions mints a short-lived OIDC
id-token that npm exchanges for publish rights. **There is no `NPM_TOKEN`
secret.** This keeps the secret-free CI invariant (`docs/ci-security.md`): the
publish workflow carries `id-token: write` but no `secrets.*`, and runs only on a
**`cli-v*` tag push** (a trusted trigger), never on a fork `pull_request`.

The trust is pinned on npmjs.com to **this repo + this workflow filename**, so a
fork minting its own id-token in its own run cannot publish our package.

### One-time npmjs.com setup

`npmjs.com → @novedu/cli → Settings → Trusted Publishing → GitHub Actions`:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `Teaching-HTL-Leonding` |
| Repository | `novedu-chat-mvp` |
| Workflow filename | `publish-cli.yml` (must match `.github/workflows/publish-cli.yml` exactly) |
| Environment name | *(blank)* |
| Allowed actions | `npm publish` |

If `publish-cli.yml` is ever renamed, this config must be updated to match or
publishing breaks.

> Optional hardening: once fully on CI publishing, **Publishing access** can be
> set to "Require 2FA and disallow tokens (recommended)". OIDC trusted publishing
> keeps working (it is not a token); only token-based automation is blocked.

## The normal release flow (CI, tag-driven)

`.github/workflows/publish-cli.yml` triggers on a `cli-v*` tag and:

1. upgrades npm to `>=11.5.1` (trusted-publishing minimum; node 24's bundled npm
   can be older),
2. **guards that the tag matches `cli/package.json` version** — a `cli-v0.2.0`
   tag against a `0.1.0` package fails fast,
3. `npm ci` → `npm run cli:build` → smoke-tests the built binary against
   `test-fixtures/activities/tutors/test-tutor.yaml`,
4. `npm publish -w @novedu/cli --provenance --access public` (auth via OIDC).

To cut a release:

```bash
# 1. Bump the version (PRs only — main is protected). In cli/package.json,
#    e.g. the next patch after the current 0.3.0:
#      "version": "0.3.1"
#    Keep the lockfile in sync, then commit:
npm install --package-lock-only
git add cli/package.json package-lock.json && git commit -m "release @novedu/cli 0.3.1"
# 2. Open a PR, let QA go green, merge to main.
# 3. Tag the merged commit and push the tag:
git tag cli-v0.3.1
git push origin cli-v0.3.1        # -> publish-cli.yml runs and publishes 0.3.1
```

Release-worthy changes are not only `cli/` diffs: the CLI **bundles** the app's
validators, and formats it owns — the activity registry consumed by
`codes sync` (`docs/registry.md`) — live in the published binary too. A change to
either reaches teachers only through a release.

Versions are **forward-only**: npm rejects republishing an existing version, and
moving a release tag is avoided. If a tagged publish fails before the registry
accepts it (see below), retire that tag and roll forward to the next version
rather than reusing the number.

## Provenance (required)

`--provenance` attaches a signed SLSA build-provenance statement (free with OIDC)
and is the reason trusted publishing is worth it. npm **cross-checks
`package.json`'s `repository.url`** against the building repo; a missing/blank one
is rejected at the registry with **HTTP 422** *before* the version is created:

```
npm error 422 ... Error verifying sigstore provenance bundle:
package.json: "repository.url" is "", expected to match
"https://github.com/Teaching-HTL-Leonding/novedu-chat-mvp" from provenance
```

`cli/package.json` therefore declares (note `directory` for the monorepo):

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/Teaching-HTL-Leonding/novedu-chat-mvp.git",
  "directory": "cli"
}
```

Verify a published version carries provenance:

```bash
npm view @novedu/cli@<version> dist.attestations
# -> { url: '.../attestations/...', provenance: { predicateType: 'https://slsa.dev/provenance/v1' } }
```

## Manual publish (bootstrap / break-glass)

The package must be created by a manual publish before npm's trusted-publisher
config can attach (it only attaches to a package that already exists). The same
manual steps are the break-glass path if CI is unavailable:

```bash
npm whoami                              # must be a publisher in the @novedu org
npm run cli:build                       # dist/ is gitignored — build first
npm publish --dry-run -w @novedu/cli    # inspect the tarball (expect 3 files)
npm publish -w @novedu/cli --access public   # add --otp=<code> if 2FA prompts
```

A manual publish from a laptop generally goes **without** `--provenance` (no OIDC
context outside CI). Prefer the CI path so releases carry provenance.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `422 ... "repository.url" is ""` | Missing/blank `repository` in `cli/package.json` — see [Provenance](#provenance-required). |
| `404` on `npm view`/`npx` right after a publish | Registry read-path/CDN propagation lag, **not** a failed publish. The website shows it immediately; the registry GET catches up within seconds–minutes. |
| Workflow fails at "Verify tag matches package version" | The `cli-vX.Y.Z` tag and `cli/package.json` version disagree. Fix one. |
| `npm publish` rejects an existing version | Versions are forward-only; bump and re-tag. |
| OIDC/permission errors in the publish step | Check the npmjs.com trusted-publisher config still matches owner/repo/`publish-cli.yml`, and that the job has `id-token: write`. |
