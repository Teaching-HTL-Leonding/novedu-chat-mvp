import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// The LLM diagnostics page WITHOUT relying on Azure (docs/diagnostics.md): the
// student gate, the browser-zone redirect, and the "not configured" card. The dev
// server reads `.env`, so whether it can address App Insights is known here the
// same way: CI has no connection string and shows the card; a local run with one
// renders the sections, which may settle in any state (without `az login` they are
// "unavailable") — the real query round-trip is the @live-telemetry spec's job.
// The hidden nav entry is asserted in permissions.spec.ts.

loadEnvConfig(process.cwd());
const configured = /applicationid=/i.test(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? "");

test("a student is denied the diagnostics page", async ({ page }) => {
  await page.goto("/diagnostics?range=today&tz=UTC");

  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.getByTestId("diagnostics-range-controls")).toHaveCount(0);
});

test.describe("as a teacher", () => {
  test.use({ storageState: TEACHER_STORAGE_STATE, timezoneId: "Europe/Vienna" });
  test.setTimeout(90_000);

  test("a bare URL gains the browser's zone and today's range", async ({ page }) => {
    await page.goto("/diagnostics");

    await expect(page).toHaveURL(/[?&]range=today/);
    await expect(page).toHaveURL(/[?&]tz=Europe%2FVienna/);
    await expect(page.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  test("the page renders its configured state", async ({ page }) => {
    await page.goto("/diagnostics?range=yesterday&tz=Europe/Vienna");
    await expect(page.getByTestId("diagnostics-range-controls")).toBeVisible();

    if (!configured) {
      await expect(page.getByTestId("diagnostics-not-configured")).toBeVisible();
      await expect(page.getByTestId("diagnostics-kpis")).toHaveCount(0);
      return;
    }
    await expect(page.getByTestId("diagnostics-not-configured")).toHaveCount(0);
    for (const id of ["kpis", "calls", "wait", "impact", "errors", "failed-calls"]) {
      await expect(page.getByTestId(`diagnostics-${id}`)).toHaveAttribute(
        "data-state",
        /^(ok|empty|unavailable)$/,
        { timeout: 60_000 },
      );
    }
  });

  test("an invalid custom range falls back with a notice", async ({ page }) => {
    await page.goto("/diagnostics?from=2026-09-25T08:00:00Z&to=2026-09-25T07:00:00Z");

    await expect(page.getByText("The custom range must start before it ends.")).toBeVisible();
    await expect(page.getByText("Custom", { exact: true })).toHaveAttribute("aria-current", "page");
  });
});
