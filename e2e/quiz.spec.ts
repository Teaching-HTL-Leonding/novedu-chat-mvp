import { expect, type Page, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// End-to-end coverage for the Quizzes feature. The link-rejection gate is
// hermetic (no DB, no LLM — runs in CI). The full author → share → answer →
// discuss flow is `@live` (`@live-llm`: it grades a real answer and runs the
// discussion through the SCCH model) and is excluded from CI like the tutor
// chat-reply spec.
//
// CopilotKit v2 testids (shared with the tutor chat): copilot-chat-textarea,
// copilot-send-button, copilot-user-message, copilot-assistant-message.

test.use({ storageState: TEACHER_STORAGE_STATE });

// A tiny one-question quiz so the @live grade + discussion stay fast.
const SAMPLE_QUIZ = `id: e2e-quiz
name: "E2E Quiz"
title: "E2E Quiz"
anonymous: true
shuffle: false
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
discussion:
  instructions: |
    Be a friendly tutor. Keep it short.
questions:
  - id: capital-austria
    title: "Capital of Austria"
    question: |
      What is the capital city of **Austria**?
    evaluation: |
      The correct answer is Vienna. Grade "correct" if the student says Vienna,
      otherwise "incorrect" (or "partial" if unsure but mentions Vienna).
`;

async function setEditorContent(page: Page, text: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

// Hermetic: a `/q` link with a bad signature is rejected server-side and the
// student sees the friendly error — no DB and no LLM are touched.
test("a tampered quiz link shows the invalid-link notice", async ({ page }) => {
  test.setTimeout(90_000); // dev compilation of /q
  await page.goto("/q?quiz=https%3A%2F%2Fexample.com%2Fq&start=1&end=9999999999&sig=deadbeef");

  await expect(page.getByRole("heading", { name: /Invalid quiz link/i })).toBeVisible({
    timeout: 30_000,
  });
});

// Full @live flow: author a quiz file, mint a link through the share form, take
// it, get a graded verdict, and run a discussion turn.
// Tagged @live-llm only (not @live-db): like the tutor chat-reply spec, it also
// writes the DB, but an LLM test implies the DB — tagging it @live-db too would
// make a `--grep @live-db`-only run (CI) select it and fail without the LLM.
test("author → share → answer → discuss", { tag: ["@live", "@live-llm"] }, async ({ page }) => {
  test.setTimeout(180_000);

  const name = `e2e-quiz-${Date.now()}`;

  // 1. Author the quiz file (kind=quiz → stored without structural checks).
  await page.goto("/files/new");
  await page.getByLabel(/Name/).fill(name);
  await page.getByLabel("Kind").selectOption("quiz");
  await setEditorContent(page, SAMPLE_QUIZ);
  await page.getByRole("button", { name: "Validate & create" }).click();
  await expect(page).toHaveURL(new RegExp(`/files/edit/${name}$`), { timeout: 60_000 });

  // 2. Mint a quiz link via the share form (prefilled with the file's URL).
  const quizUrl = `${new URL(page.url()).origin}/api/files/${name}`;
  await page.goto(`/share-quiz?quiz=${encodeURIComponent(quizUrl)}`);
  await page.getByRole("button", { name: "Now" }).click();
  await page.getByRole("button", { name: "+1d" }).click();
  await page.getByRole("button", { name: "Create quiz link" }).click();
  const link = await page.getByLabel("Quiz link").inputValue();
  expect(link).toContain("/q?quiz=");

  // 3. Take the quiz: answer the question and get a verdict.
  await page.goto(link);
  const answer = page.getByLabel("Your answer");
  await expect(answer).toBeVisible({ timeout: 30_000 });
  await answer.fill("The capital of Austria is Vienna.");
  await page.getByRole("button", { name: "Submit answer" }).click();

  // A verdict heading (correct / partly correct / wrong) appears with feedback.
  await expect(page.getByRole("heading", { name: /correct|partly correct|wrong/i })).toBeVisible({
    timeout: 60_000,
  });

  // 4. Open the discussion. It opens in a modal <dialog> that shows the graded
  // feedback at the top (not the full seeded conversation), then accepts a
  // follow-up that must get a reply.
  await page.getByRole("button", { name: "Chat about this" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill("Why is that the capital?");
  await page.getByTestId("copilot-send-button").click();

  const assistant = page.getByTestId("copilot-assistant-message");
  await expect(assistant).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);

  // 5. Clean up the quiz file (no automatic GC).
  await page.goto(`/files/edit/${name}`);
  page.once("dialog", (dialog) => dialog.accept());
  const del = page.getByRole("button", { name: /delete/i }).first();
  if (await del.isVisible().catch(() => false)) await del.click();
});
