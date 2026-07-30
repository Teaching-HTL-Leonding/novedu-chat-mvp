---
name: novedu-publish
description: Publish novedu into production
---

**Prerequisite:** After your changes, you performed a full QA run including live e2e tests.

**Check whether the CLI must be republished** — but *not* by "are there changes under `./cli`". The CLI's `validate` command bundles the app's validators (`lib/prompt-fragments`, the `*-validate` modules, `lib/tutors`) into `dist/main.js` at build time, so the published `@novedu/cli` goes stale whenever those change, even with no `./cli` diff. Republish if the release touches any module the CLI imports (`grep -rhoE "@/lib/[^\"']+" cli/src`) or anything they import. If the user already decided, follow that; if borderline, ask.

**Note:** the production image contains the teacher guide at `/docs` — the Docker build compiles `teacher-docs-site/` and stages it into `public/docs/` automatically, so no extra publish step exists for docs. A `teacher-docs/**` change therefore needs this publish flow to reach production (`docker-publish.yml` triggers on it by design).

**Steps:**
1. Create a new branch with a fitting name
2. Commit changes to the branch
3. Create a PR based on the branch
4. Monitor the QA GH Action using `gh` CLI and wait for it to complete
5. If the QA run is successful, merge the PR
6. Monitor the production deployment and ensure it completes successfully

**Publishing the CLI** (when the check above says so): bump `cli/package.json` `"version"` (usually no source change — the new logic is bundled on rebuild), land it on `main` via the steps above, then `git tag cli-v<version> && git push origin cli-v<version>` to trigger `publish-cli.yml`. Verify with `npm view @novedu/cli version`.
