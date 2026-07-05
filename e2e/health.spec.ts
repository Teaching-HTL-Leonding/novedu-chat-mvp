import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// Read the dev server's .env the way Next does, so the Foundry assertions below
// mirror exactly what the server sees (AZURE_FOUNDRY_ENDPOINT set or not).
loadEnvConfig(process.cwd());

// The /health page renders its shell immediately (the server only gates access
// and supplies session facts); the connectivity probes are fetched by the
// client from the teacher-only /api/health endpoint and each indicator updates
// as its own result arrives. The student block runs on the project-default
// storage state (no isTeacher claim); the teacher block opts into the teacher
// state, mirroring permissions.spec.ts.

test.describe("as a student", () => {
  test("the Health page is denied", async ({ page }) => {
    await page.goto("/health");

    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    // None of the indicators are rendered.
    await expect(page.getByTestId("health-db")).toHaveCount(0);
  });

  test("the health API responds 403", async ({ page }) => {
    // The API is the enforcement point (the page check is only UX) — hit it
    // directly with the student's session cookie.
    const res = await page.request.get("/api/health?probe=db");

    expect(res.status()).toBe(403);
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

  // @live: probes hit the real Azure SQL DB + SCCH endpoint — excluded in CI (test:e2e:ci).
  test("renders the shell immediately and resolves all probes", {
    tag: ["@live", "@live-llm"],
  }, async ({ page }) => {
    await page.goto("/health");

    // Shell facts (session-derived, no probe round-trip) are correct at once.
    await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
    await expect(page.getByTestId("health-user")).toContainText("E2E Teacher");
    await expect(page.getByTestId("health-teacher")).toHaveText("Yes");

    // Probe rows resolve asynchronously. DB and SCCH hit the real dependencies
    // configured in .env — both must be reachable from the dev machine.
    await expect(page.getByTestId("health-db")).toContainText("OK", { timeout: 20_000 });
    await expect(page.getByTestId("health-scch")).toContainText("OK", { timeout: 20_000 });
    await expect(page.getByTestId("health-scch")).toContainText("models available");

    // FQDN + at least one resolved IP for both dependency hosts. The FQDNs
    // come from .env, so assert shape (host — dotted address), not values.
    const hostPattern = /\S+\.\S+ — \d+\.\d+\.\d+\.\d+|\S+\.\S+ — [0-9a-f:]+/i;
    await expect(page.getByTestId("health-sql-host")).toHaveText(hostPattern, {
      timeout: 20_000,
    });
    await expect(page.getByTestId("health-scch-host")).toHaveText(hostPattern, {
      timeout: 20_000,
    });

    // Azure Foundry is optional: when configured, its probe must pass (Entra
    // token via `az login` + a model listing); when not, its rows must not exist.
    if (process.env.AZURE_FOUNDRY_ENDPOINT) {
      await expect(page.getByTestId("health-foundry")).toContainText("OK", { timeout: 20_000 });
      await expect(page.getByTestId("health-foundry")).toContainText("models available");
      await expect(page.getByTestId("health-foundry-host")).toHaveText(hostPattern, {
        timeout: 20_000,
      });
    } else {
      await expect(page.getByTestId("health-foundry")).toHaveCount(0);
      await expect(page.getByTestId("health-foundry-host")).toHaveCount(0);
    }
  });

  test("the nav menu links to the Health page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("link", { name: "Health" }).click();

    // App-router client navigation updates the URL only once the RSC payload
    // arrives — the first dev compile of /health can take a while.
    await expect(page).toHaveURL("/health", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
  });
});
