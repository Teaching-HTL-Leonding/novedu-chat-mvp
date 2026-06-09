import { expect, test } from "@playwright/test";

// The security property this whole feature exists for: an unauthenticated
// visitor must never reach the app. The other specs run with a minted session
// cookie (see auth.setup.ts); here we override storageState to empty so the
// browser arrives logged out, overriding the chromium project's default. If the
// proxy matcher ever stops gating a protected path, this test fails.
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated users are redirected to the sign-in page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});

test("unauthenticated users cannot reach the tutor-validation page", async ({ page }) => {
  await page.goto("/validate-tutor");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});
