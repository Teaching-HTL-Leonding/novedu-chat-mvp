import { expect, test } from "@playwright/test";

// Exercises the main page end-to-end: enter a public tutor-YAML URL → the app
// validates it via /api/validate-tutor → a valid tutor switches to a chat driven
// by that tutor (system prompt + model from the YAML); a broken one shows the
// structured error list. The stable sample files under tutors/ keep these URLs
// valid. No chat message is sent, so no LLM round-trip is needed.

const RAW =
  "https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/tutors";
const VALID_TUTOR_URL = `${RAW}/simple-tutor.yaml`;
const BROKEN_TUTOR_URL = `${RAW}/broken-tutor.yaml`;

// Network round-trip to GitHub + Next dev compilation — give it room.
test.setTimeout(60_000);

test("a valid tutor URL starts a tutor-driven chat", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox").fill(VALID_TUTOR_URL);
  await page.getByRole("button", { name: "Start" }).click();

  // The form is replaced by the chat view with a "Change tutor" control.
  await expect(page.getByRole("button", { name: "Change tutor" })).toBeVisible({
    timeout: 30_000,
  });

  // The chat must actually initialize: CopilotKit syncs its runtime (GET /info)
  // and the composer appears. Regression guard — passing the tutor URL on the
  // runtime URL's query string corrupted the /info sub-path (404 → "no agents"),
  // so wait past the sync and assert no runtime-sync error surfaced.
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);

  // The assembled system prompt is available in the collapsible preview.
  await page.getByText("System prompt & warnings").click();
  await expect(page.locator('code[class*="language-"]')).toContainText("basic arithmetic");
});

test("a broken tutor URL shows the error list and no chat", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox").fill(BROKEN_TUTOR_URL);
  await page.getByRole("button", { name: "Start" }).click();

  // The broken tutor omits a required variable and references a missing fragment.
  await expect(page.getByText("MISSING_REQUIRED_VARIABLE")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("FRAGMENT_NOT_FOUND")).toBeVisible();
  // Stays on the form — no chat view.
  await expect(page.getByRole("button", { name: "Change tutor" })).toHaveCount(0);
});
