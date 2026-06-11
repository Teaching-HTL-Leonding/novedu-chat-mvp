import { expect, test } from "@playwright/test";
import { makeShareLink, openWindow, VALID_TUTOR_URL } from "./share-link.utils";

// The chat is reachable only through a teacher's signed deep link. These specs
// run as a STUDENT (project-default storage state) and mint links directly with
// the server's secret (share-link.utils) — every rejection path must end in a
// clear, human-readable explanation, and a genuine link must open the chat.

// The valid-link specs fetch the sample tutor from GitHub — give them room.
test.setTimeout(60_000);

test("the chat without a share link explains that a link is required", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Novedu/);
  await expect(page.getByRole("heading", { name: "No tutor link" })).toBeVisible();
  await expect(page.getByText(/ask your teacher/i)).toBeVisible();
  // No chat composer.
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("a tampered link is rejected as invalid", async ({ page }) => {
  const link = new URL(makeShareLink(openWindow(VALID_TUTOR_URL)));
  // The student tries to stretch the window — signature no longer matches.
  link.searchParams.set("end", String(Number(link.searchParams.get("end")) + 86_400));

  await page.goto(link.toString());

  await expect(page.getByRole("heading", { name: "Invalid share link" })).toBeVisible();
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("an expired link is rejected with the end time", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  const link = makeShareLink({ tutor: VALID_TUTOR_URL, start: now - 7200, end: now - 3600 });

  await page.goto(link);

  await expect(page.getByRole("heading", { name: "Share link expired" })).toBeVisible();
  await expect(page.locator("time")).toBeVisible();
});

test("a not-yet-active link is rejected with the start time", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  const link = makeShareLink({ tutor: VALID_TUTOR_URL, start: now + 3600, end: now + 7200 });

  await page.goto(link);

  await expect(page.getByRole("heading", { name: "Tutor not available yet" })).toBeVisible();
  await expect(page.locator("time")).toBeVisible();
});

// @live: needs the real share-link table — without storage configured the lookup
// reports "temporarily unavailable", not "unknown". Excluded in CI (test:e2e:ci).
test("a well-formed but unknown short code is rejected as unknown", { tag: "@live" }, async ({
  page,
}) => {
  // Never issued (or already garbage-collected) — requires a live table lookup.
  await page.goto("/?link=zzzzzzzzzz");

  await expect(page.getByRole("heading", { name: "Unknown share link" })).toBeVisible();
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("a malformed short code is rejected without a storage lookup", async ({ page }) => {
  await page.goto("/?link=not-a-code");

  await expect(page.getByRole("heading", { name: "Unknown share link" })).toBeVisible();
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

test("a valid link opens the tutor chat for a student", async ({ page }) => {
  await page.goto(makeShareLink(openWindow(VALID_TUTOR_URL)));

  // The chat must actually initialize: CopilotKit syncs its runtime (GET /info,
  // which re-verifies the signed headers server-side) and the composer appears.
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);

  // The assembled system prompt is available in the collapsible preview.
  await page.getByText("System prompt & warnings").click();
  await expect(page.locator('code[class*="language-"]')).toContainText("basic arithmetic");
});
