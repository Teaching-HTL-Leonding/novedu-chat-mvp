import { expect, test } from "@playwright/test";
import { mintTutorCode } from "./tutor-code.utils";

// The chat is reachable only through a teacher's Tutor Code (`/<code>`). These
// specs run as a STUDENT (project-default storage state).
//
// The client-side checks below need no infrastructure and run in CI. The
// rejection RENDERING (unknown/expired/not-started → the right heading + the
// window <time>) is now covered by fast tests that need no database:
//   - the page's consumption of checkTutorCode → app/[code]/page.unit.test.tsx
//   - the rejection components themselves → tests/component/tutor-code-error.browser.test.tsx
// What remains here is one @live happy-path smoke that genuinely needs a minted
// code + the real chat runtime (local-only; excluded in CI via test:e2e:ci).

// The valid-code smoke fetches the sample tutor from GitHub — give it room.
test.setTimeout(60_000);

test("the root URL shows the tutor-code entry form", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Novedu/);
  await expect(page.getByRole("heading", { name: "Enter your tutor code" })).toBeVisible();
  await expect(page.getByLabel("Tutor code")).toBeVisible();
  // No chat composer.
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("a malformed code in the entry form is rejected client-side", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Tutor code").fill("not-a-code");
  await page.getByRole("button", { name: "Open chat" }).click();

  await expect(page.getByText(/10 letters\/digits/)).toBeVisible();
  // No navigation happened.
  await expect(page).toHaveURL("/");
});

test("a malformed code in the URL is rejected without a database lookup", async ({ page }) => {
  await page.goto("/definitely-not-a-code");

  await expect(page.getByRole("heading", { name: "Unknown tutor code" })).toBeVisible();
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("a valid code opens the tutor chat for a student", { tag: "@live" }, async ({ page }) => {
  const code = await mintTutorCode();
  await page.goto(`/${code}`);

  // The chat must actually initialize: CopilotKit syncs its runtime (GET /info,
  // which re-checks the tutor-code header server-side) and the composer appears.
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);

  // The assembled system prompt is available in the collapsible preview.
  await page.getByText("System prompt & warnings").click();
  await expect(page.locator('code[class*="language-"]')).toContainText("basic arithmetic");
});
