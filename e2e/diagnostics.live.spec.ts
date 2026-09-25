import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// @live @live-telemetry: the diagnostics page against the REAL App Insights
// resource named by `.env`'s APPLICATIONINSIGHTS_CONNECTION_STRING, read with the
// developer's `az login` (docs/diagnostics.md). Its value: it proves the query
// endpoint accepts all five KQL queries — tables, columns, `customDimensions` —
// which no mocked test can. Local only (`npm run test:e2e:telemetry`); CI stays
// secret-free. It cannot prove a deployed identity's Reader role — open
// /diagnostics once on that environment for that.

loadEnvConfig(process.cwd());

test.use({ storageState: TEACHER_STORAGE_STATE, timezoneId: "Europe/Vienna" });

test("every diagnostics section loads from App Insights and the report copies", {
  tag: ["@live", "@live-telemetry"],
}, async ({ page, context }) => {
  test.skip(
    !process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
    "APPLICATIONINSIGHTS_CONNECTION_STRING is not set — needs .env + az login.",
  );
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/diagnostics?range=last7d&tz=Europe/Vienna");
  await expect(page.getByTestId("diagnostics-not-configured")).toHaveCount(0);

  for (const id of ["kpis", "calls", "wait", "impact", "errors", "failed-calls"]) {
    await expect(page.getByTestId(`diagnostics-${id}`)).toHaveAttribute(
      "data-state",
      /^(ok|empty)$/,
      { timeout: 45_000 },
    );
  }

  await page.getByTestId("diagnostics-copy-report").click();
  await expect(page.getByTestId("diagnostics-copy-report")).toHaveText("Copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.startsWith("Novedu — LLM diagnostics\n")).toBe(true);
  expect(text).toContain("Range:     ");
  expect(text).toContain("Europe/Vienna");
});
