import { expect, test } from "@playwright/test";
import { mintTutorCode } from "./tutor-code.utils";

// The chat is reachable only through a teacher's Tutor Code (`/<code>`). These
// specs run as a STUDENT (project-default storage state) and mint codes
// directly in the database (tutor-code.utils) — every rejection path must end
// in a clear, human-readable explanation, and a genuine code must open the
// chat.

// The valid-code specs fetch the sample tutor from GitHub — give them room.
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

// @live: needs the real database — without it the lookup reports "temporarily
// unavailable", not "unknown". Excluded in CI (test:e2e:ci).
test("a well-formed but unknown code is rejected as unknown", { tag: "@live" }, async ({
  page,
}) => {
  // Never issued (or already garbage-collected) — requires a live lookup.
  await page.goto("/zzzzzzzzzz");

  await expect(page.getByRole("heading", { name: "Unknown tutor code" })).toBeVisible();
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("an expired code is rejected with the end time", { tag: "@live" }, async ({ page }) => {
  const code = await mintTutorCode({ startOffset: -7200, endOffset: -3600 });

  await page.goto(`/${code}`);

  await expect(page.getByRole("heading", { name: "Tutor code expired" })).toBeVisible();
  await expect(page.locator("time")).toBeVisible();
});

test("a not-yet-active code is rejected with the start time", { tag: "@live" }, async ({
  page,
}) => {
  const code = await mintTutorCode({ startOffset: 3600, endOffset: 7200 });

  await page.goto(`/${code}`);

  await expect(page.getByRole("heading", { name: "Tutor not available yet" })).toBeVisible();
  await expect(page.locator("time")).toBeVisible();
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

test("a successfully opened code appears under Recently used and a dead one disappears", {
  tag: "@live",
}, async ({ page }) => {
  // Two chat opens plus deliberately waiting out a 25 s window.
  test.setTimeout(120_000);
  // Open a valid code, labeled with its note...
  const note = `e2e recents ${Date.now()}`;
  const code = await mintTutorCode({ note });
  await page.goto(`/${code}`);
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 30_000 });

  // ...and find it as a shortcut on the entry page (recorded server-side).
  await page.goto("/");
  await expect(page.getByRole("link", { name: note })).toBeVisible();

  // An expired code, once clicked, vanishes from the shortcuts.
  const deadNote = `e2e dead ${Date.now()}`;
  const dead = await mintTutorCode({ note: deadNote, endOffset: 25 });
  await page.goto(`/${dead}`);
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 20_000 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: deadNote })).toBeVisible();

  // Wait out the window, click the shortcut → error page → shortcut gone.
  await page.waitForTimeout(26_000);
  await page.getByRole("link", { name: deadNote }).click();
  await expect(page.getByRole("heading", { name: "Tutor code expired" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: deadNote })).toHaveCount(0);
});
