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

test("unauthenticated users cannot reach the new-tutor-code page", async ({ page }) => {
  await page.goto("/tutor-codes/new");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});

test("a tutor-code URL still requires sign-in", async ({ page }) => {
  // Anonymous users cannot use the app even with a genuine tutor code — the
  // code only authorizes the tutor + window, never the user.
  await page.goto("/a1b2c3d4e5");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});

test("unauthenticated users cannot reach the create-quiz-link page", async ({ page }) => {
  await page.goto("/share-quiz");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});

test("a quiz link still requires sign-in", async ({ page }) => {
  // Like a tutor code, the signed quiz link authorizes the quiz + window, never
  // the user — the Entra gate (proxy.ts) must still apply to `/q`.
  await page.goto("/q?quiz=https%3A%2F%2Fexample.com%2Fq&start=1&end=9999999999&sig=deadbeef");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});
