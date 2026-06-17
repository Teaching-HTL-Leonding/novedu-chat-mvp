# `e2e/yaml-gui/` — student end-to-end tests

Put your Playwright specs for the YAML GUI here (`*.spec.ts`). They are picked up
by the normal `npm run test:e2e` run (Playwright `testDir` is `./e2e`).

- Authenticated specs run as a teacher automatically (see `e2e/auth.setup.ts`).
- Tag a spec `@live` only if it needs the **real** database or LLM — those are
  excluded from CI (`npm run test:e2e:ci`) and run locally with
  `npm run test:e2e -- --grep @live`. See `docs/testing.md`.

Example skeleton:

```ts
import { expect, test } from "@playwright/test";

test("edit-in-GUI opens the student editor", async ({ page }) => {
  await page.goto("/files/gui/edit/<some-file-name>");
  await expect(page.getByRole("heading")).toBeVisible();
});
```
