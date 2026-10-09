import { expect, test } from "@playwright/test";
import { mintTutorCode } from "./code.utils";

// An activity is reachable only through a teacher's code (`/<code>`). These specs
// run as a STUDENT (project-default storage state).
//
// The client-side checks below need no infrastructure and run in CI. The
// rejection RENDERING (unknown/expired/not-started → the right heading + the
// window <time>) is covered by fast tests that need no database:
//   - the page's consumption of checkCode → app/[code]/page.unit.test.tsx
//   - the rejection components themselves → app/code-error.unit.test.tsx
// What remains here is one @live-db happy-path smoke that genuinely needs a minted
// code + a real database (no LLM — the composer renders without SCCH), so it runs
// in CI against the Postgres container as well as locally.

test("the root URL shows the code entry form", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Novedu/);
  await expect(page.getByRole("heading", { name: "Welcome back, E2E" })).toBeVisible();
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
  const info = page.waitForResponse((res) => res.url().includes("/api/copilotkit/info"));
  await page.goto(`/${code}`);

  // The chat must actually initialize: the composer appears, and once CopilotKit
  // has synced its runtime (GET /info, auth-only — it lists the student-facing
  // agents) the chat's agent resolves instead of throwing "not found after
  // runtime sync". No DOM signal marks that resolution, so after the /info
  // response the check gets a short settle before asserting the error's absence.
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible();
  await info;
  await page.waitForTimeout(1000);
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);
});
