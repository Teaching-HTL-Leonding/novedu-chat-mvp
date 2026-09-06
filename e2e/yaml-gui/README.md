# `e2e/yaml-gui/` — student end-to-end tests

Put your Playwright specs for the YAML GUI here (`*.spec.ts`). They are picked up
by the normal `npm run test:e2e` run (Playwright `testDir` is `./e2e`).

- Authenticated specs run as a teacher automatically (see `e2e/auth.setup.ts`).
- Tag a spec only if it needs the **real** database — use `["@live", "@live-db"]`.
  `@live-db` tests DO run in CI against an ephemeral Postgres container, so your
  DB-backed GUI specs get CI coverage. The GUI never needs the LLM, so you should
  never need `@live-llm`. Leave a spec untagged if it needs no real database. See
  `docs/testing.md`.

Example skeleton:

```ts
import { expect, test } from "@playwright/test";

test("edit-in-GUI opens the student editor", async ({ page }) => {
  await page.goto("/files/gui/edit/<some-file-name>");
  await expect(page.getByRole("heading")).toBeVisible();
});
```
