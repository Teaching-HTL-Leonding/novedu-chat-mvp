import { expect, test } from "@playwright/test";
import { mintTutorCode } from "./tutor-code.utils";

// Mid-session window expiry: the backend rejects runtime requests the moment
// the code's window closes (re-checked per request), but the chat SURFACE must
// survive — the student may still want to read or copy the conversation. Only
// a reload shows the full-page "Tutor code expired" explanation.

// Page load + waiting out the window + the failed send.
test.setTimeout(90_000);

// @live: minting the code and every chat request need the live database.
test("when the window closes mid-session the chat stays on screen", { tag: "@live" }, async ({
  page,
}) => {
  // A window that ends shortly after the page loads. Generous enough for a dev
  // compile; the test then waits out whatever remains.
  const endOffset = 25;
  const end = Math.floor(Date.now() / 1000) + endOffset;
  const code = await mintTutorCode({ endOffset });
  await page.goto(`/${code}`);

  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });

  // Wait until the window is definitely over.
  const remaining = end * 1000 - Date.now() + 1500;
  if (remaining > 0) await page.waitForTimeout(remaining);

  // Sending now hits the backend's per-request check → 403.
  await composer.fill("Can I still ask?");
  await page.getByTestId("copilot-send-button").click();

  // The chat surface must NOT disappear: the transcript (with the student's
  // message) and the composer stay available for reading/copying.
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("copilot-user-message")).toContainText("Can I still ask?");
  await expect(composer).toBeVisible();
  // No full-page error replaced the chat (that only happens on reload).
  await expect(page.getByRole("heading", { name: "Tutor code expired" })).toHaveCount(0);
});
