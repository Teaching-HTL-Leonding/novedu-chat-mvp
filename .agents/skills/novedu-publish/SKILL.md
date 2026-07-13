---
name: novedu-publish
description: Publish novedu into production
---

**Prerequisite:** After your changes, you performed a full QA run including live e2e tests.

**Check** if there are changes to the Novedu CLI (`./cli`). If there are, publishing a new version of the CLI might be required. If the user explicitly decided whether to publish a new version, follow the user's decision. If the user did not explicitly decide, stop and ask the user what you should do.

**Note:** the production image contains the teacher guide at `/docs` — the Docker build compiles `teacher-docs-site/` and stages it into `public/docs/` automatically, so no extra publish step exists for docs. A `teacher-docs/**` change therefore needs this publish flow to reach production (`docker-publish.yml` triggers on it by design).

**Steps** (add proper steps if a new version of the CLI needs to be published):
1. Create a new branch with a fitting name
2. Commit changes to the branch
3. Create a PR based on the branch
4. Monitor the QA GH Action using `gh` CLI and wait for it to complete
5. If the QA run is successful, merge the PR
6. Monitor the production deployment and ensure it completes successfully
