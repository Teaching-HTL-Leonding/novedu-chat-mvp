import { expect, test } from "@playwright/test";
import { mintTutorCode } from "./code.utils";

// Mid-session window expiry: the backend rejects runtime requests the moment
// the code's window closes (re-checked per request), but the chat SURFACE must
// survive — the student may still want to read or copy the conversation. Only
// a reload shows the full-page "Code expired" explanation.

// Page load + waiting out the window + the failed send.
test.setTimeout(90_000);

// @live: minting the code and every chat request need the live database.
test("when the window closes mid-session the chat stays on screen", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: "Code expired" })).toHaveCount(0);
});

// An open-ended code (both window bounds NULL — opens immediately, never expires)
// must serve. This is the ONLY automated coverage that a real NULL valid_from /
// valid_until column round-trips: it proves the nullable-column migration took
// effect (an INSERT of a null bound succeeds) and that checkCode coalesces an
// absent bound to "open" against a live row, not just the in-memory fake.
// @live-db only — the composer renders without the LLM, exactly like the
// valid-code happy path.
test("an open-ended code (both bounds null) opens the chat", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  const code = await mintTutorCode({ startOffset: null, endOffset: null });
  await page.goto(`/${code}`);

  // The code serves: the chat initializes and the composer appears (the runtime
  // route re-checks the code header server-side and accepts the null window).
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible({ timeout: 30_000 });
  // Neither window bound rejected it — no full-page "not yet" / "expired" error.
  await expect(page.getByRole("heading", { name: "Not available yet" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Code expired" })).toHaveCount(0);
});
