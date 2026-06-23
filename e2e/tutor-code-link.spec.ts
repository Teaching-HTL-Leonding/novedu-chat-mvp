import { expect, test } from "@playwright/test";
import { mintTutorCode } from "./code.utils";

// An activity is reachable only through a teacher's code (`/<code>`). These specs
// run as a STUDENT (project-default storage state).
//
// The client-side checks below need no infrastructure and run in CI. The
// rejection RENDERING (unknown/expired/not-started → the right heading + the
// window <time>) is now covered by fast tests that need no database:
//   - the page's consumption of checkCode → app/[code]/page.unit.test.tsx
//   - the rejection components themselves → tests/component/code-error.browser.test.tsx
// What remains here is one @live-db happy-path smoke that genuinely needs a minted
// code + a real database (no LLM — the composer renders without SCCH), so it runs
// in CI against the SQL Server container as well as locally.

// The valid-code smoke fetches the sample tutor from GitHub — give it room.
test.setTimeout(60_000);

test("the root URL shows the code entry form", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Novedu/);
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await expect(page.getByLabel("Code")).toBeVisible();
  // No chat composer.
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("a malformed code in the entry form is rejected client-side", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Code").fill("not a code");
  await page.getByRole("button", { name: "Open", exact: true }).click();

  await expect(page.getByText(/letters\/digits\/hyphens/)).toBeVisible();
  // No navigation happened.
  await expect(page).toHaveURL("/");
});

test("a malformed code in the URL is rejected without a database lookup", async ({ page }) => {
  await page.goto("/definitely-not-a-code-because-it-is-far-too-long-to-be-one-ok");

  await expect(page.getByRole("heading", { name: "Unknown code" })).toBeVisible();
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("a valid code opens the tutor chat for a student", { tag: ["@live", "@live-db"] }, async ({
  page,
}) => {
  const code = await mintTutorCode();
  await page.goto(`/${code}`);

  // The chat must actually initialize: CopilotKit syncs its runtime (GET /info,
  // which re-checks the code header server-side) and the composer appears.
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);

  // The assembled system prompt is available in the collapsible preview.
  await page.getByText("System prompt & warnings").click();
  await expect(page.locator('code[class*="language-"]')).toContainText("basic arithmetic");
});
