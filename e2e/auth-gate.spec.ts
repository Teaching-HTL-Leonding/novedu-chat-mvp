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

test("unauthenticated users cannot reach the files page", async ({ page }) => {
  await page.goto("/files");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});

test("unauthenticated users cannot reach the new-code page", async ({ page }) => {
  await page.goto("/codes/new");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});

test("unauthenticated users cannot reach the codes list page", async ({ page }) => {
  await page.goto("/codes");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});

test("a code URL still requires sign-in", async ({ page }) => {
  // Anonymous users cannot use the app even with a genuine code (any module) —
  // the code only authorizes the activity + window, never the user.
  await page.goto("/a1b2c3d4e5");

  await expect(page).toHaveURL(/\/api\/auth\/signin/);
});
