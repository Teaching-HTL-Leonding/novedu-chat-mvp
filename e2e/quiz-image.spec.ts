import path from "node:path";
import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { mintCode, VISION_QUIZ_URL } from "./code.utils";

// A REAL multi-modal round-trip through the QUIZ grader: submit an IMAGE-ONLY
// answer (also exercising the empty-text path) and confirm the model actually
// saw the pixels — the vision quiz's evaluation grades "correct" if and only if
// the attached image is solid red, so the verdict can only be right if the
// photo reached the model. Then open the discussion and require one reply,
// proving the seeded `file` part didn't break the discussion agent.
//
// Modeled on the tutor's image-attachment.spec.ts (same red.png fixture, same
// local fixtures server); the Add-photo GATING and the client-side validation
// are our code's contribution and are covered without a browser/LLM in
// tests/component/quiz-runner.browser.test.tsx and the quiz-actions unit tests.
// @live-llm only (not @live-db): an LLM test implies the DB — excluded from CI.

test.use({ storageState: TEACHER_STORAGE_STATE });

const RED_PNG = path.join(process.cwd(), "e2e", "fixtures", "red.png");

test("a photo answer is graded by the vision model and seeds the discussion", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  // Image upload + a full vision-model round-trip + a discussion turn.
  test.setTimeout(180_000);

  const code = await mintCode({ module: "quiz", file: VISION_QUIZ_URL });
  await page.goto(`/${code}`);

  // The vision quiz enables photo answers, so the Add-photo control is offered.
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="file"]').setInputFiles(RED_PNG);
  await expect(page.getByAltText("red.png")).toBeVisible();

  // Submit IMAGE-ONLY (no text) — enabled by the photo alone.
  await page.getByRole("button", { name: "Submit answer" }).click();

  // Only the pixels say "red": a `correct` verdict proves the model saw them.
  await expect(page.getByRole("heading", { name: /^correct$/i })).toBeVisible({
    timeout: 60_000,
  });

  // The discussion thread is seeded with the photo as a `file` part; one reply
  // proves the discussion agent handles the multimodal history.
  await page.getByRole("button", { name: "Chat about this" }).click();
  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill("What color was the image I submitted? Answer with one word.");
  await page.getByTestId("copilot-send-button").click();

  const assistant = page.getByTestId("copilot-assistant-message");
  await expect(assistant).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);
});
