import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// The /health page runs live probes (database round-trip, SCCH model listing,
// DNS lookups) server-side on every request and is teacher-only. The student
// block runs on the project-default storage state (no isTeacher claim); the
// teacher block opts into the teacher state, mirroring permissions.spec.ts.

test.describe("as a student", () => {
  test("the Health page is denied", async ({ page }) => {
    await page.goto("/health");

    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    // None of the indicators are rendered.
    await expect(page.getByTestId("health-db")).toHaveCount(0);
  });

  test("the nav menu hides the Health entry", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation menu" }).click();

    await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Health" })).toHaveCount(0);
  });
});

test.describe("as a teacher", () => {
  test.use({ storageState: TEACHER_STORAGE_STATE });

  // Live dependency probes (DB round-trip, SCCH fetch) + dev compilation.
  test.setTimeout(60_000);

  test("shows all health indicators", async ({ page }) => {
    await page.goto("/health");

    await expect(page.getByRole("heading", { name: "Health" })).toBeVisible({ timeout: 30_000 });

    // Database and SCCH probes hit the real dependencies configured in .env —
    // both must be reachable from the dev machine.
    await expect(page.getByTestId("health-db")).toContainText("OK");
    await expect(page.getByTestId("health-scch")).toContainText("OK");
    await expect(page.getByTestId("health-scch")).toContainText("models available");

    // Identity of the minted teacher session.
    await expect(page.getByTestId("health-user")).toContainText("E2E Teacher");
    await expect(page.getByTestId("health-teacher")).toHaveText("Yes");

    // FQDN + at least one resolved IP for both dependency hosts. The FQDNs
    // come from .env, so assert shape (host — dotted address), not values.
    const hostPattern = /\S+\.\S+ — \d+\.\d+\.\d+\.\d+|\S+\.\S+ — [0-9a-f:]+/i;
    await expect(page.getByTestId("health-sql-host")).toHaveText(hostPattern);
    await expect(page.getByTestId("health-scch-host")).toHaveText(hostPattern);
  });

  test("the nav menu links to the Health page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("link", { name: "Health" }).click();

    // App-router client navigation updates the URL only once the RSC payload
    // arrives — the first dev compile of /health can take a while.
    await expect(page).toHaveURL("/health", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Health" })).toBeVisible({ timeout: 30_000 });
  });
});
