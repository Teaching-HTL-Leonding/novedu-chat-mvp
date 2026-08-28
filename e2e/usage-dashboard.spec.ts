import { expect, test } from "@playwright/test";

// The teacher gate on the usage dashboard, tested WITHOUT infra: the chromium
// project's default session is the STUDENT (see auth.setup.ts), so this spec runs
// as a signed-in non-teacher. `isEffectiveTeacher()` short-circuits before any
// store call, so no DB is needed — hermetic, runs in CI. A teacher in "view as
// student" mode is the same effective-student and is likewise denied.

// The hidden nav entry is asserted with every other teacher-only entry in
// permissions.spec.ts, which opens the menu once for all of them.
test("a student is denied the usage dashboard", async ({ page }) => {
  await page.goto("/usage");

  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
});
