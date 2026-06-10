import { expect, test } from "@playwright/test";
import { makeShareLink, VALID_TUTOR_URL } from "./share-link.utils";

// Mid-session window expiry: the backend rejects runtime requests the moment
// the signed window closes (verified per request), but the chat SURFACE must
// survive — the student may still want to read or copy the conversation. Only
// a reload shows the full-page "Share link expired" explanation.

// Page load + waiting out the window + the failed send.
test.setTimeout(90_000);

test("when the window closes mid-session the chat stays on screen", async ({ page }) => {
  // A window that ends shortly after the page loads. Generous enough for a dev
  // compile; the test then waits out whatever remains.
  const now = Math.floor(Date.now() / 1000);
  const end = now + 25;
  await page.goto(makeShareLink({ tutor: VALID_TUTOR_URL, start: now - 3600, end }));

  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });

  // Wait until the window is definitely over.
  const remaining = end * 1000 - Date.now() + 1500;
  if (remaining > 0) await page.waitForTimeout(remaining);

  // Sending now hits the backend's per-request verification → 403.
  await composer.fill("Can I still ask?");
  await page.getByTestId("copilot-send-button").click();

  // The chat surface must NOT disappear: the transcript (with the student's
  // message) and the composer stay available for reading/copying.
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("copilot-user-message")).toContainText("Can I still ask?");
  await expect(composer).toBeVisible();
  // No full-page error replaced the chat (that only happens on reload).
  await expect(page.getByRole("heading", { name: "Share link expired" })).toHaveCount(0);
});
