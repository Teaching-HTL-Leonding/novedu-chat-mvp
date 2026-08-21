import { expect, type Page, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { sendAndExpectReply } from "./chat.utils";
import { mintCode } from "./code.utils";

// End-to-end coverage for the Quizzes feature, now reached as first-class CODES
// (a `novedu_codes` row with `module: "quiz"`) at `/<code>` — no signed links.
// The code-expiry gate needs the DB but no LLM (@live-db, runs in CI). The full
// author → code → answer → discuss flow is `@live` (`@live-llm`: it grades a real
// answer and runs the discussion through the SCCH model) and is excluded from CI
// like the tutor chat-reply spec.
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

// A quiz code outside its window is refused exactly like any other code — the
// shared window check fires before the quiz is ever loaded, so this needs the DB
// (to mint the row) but no LLM.
test("an expired quiz code shows the window-error notice", { tag: ["@live", "@live-db"] }, async ({
  page,
}) => {
  test.setTimeout(90_000); // dev compilation of /[code]
  // The file URL is never fetched — the expiry check rejects first.
  const code = await mintCode({
    module: "quiz",
    file: "https://example.com/api/files/never-loaded",
    endOffset: -10,
  });
  await page.goto(`/${code}`);

  await expect(page.getByRole("heading", { name: "Code expired" })).toBeVisible({
    timeout: 30_000,
  });
});

// Full @live flow: author a quiz file, mint a quiz CODE for it, open it, get a
// graded verdict, and run a discussion turn.
// Tagged @live-llm only (not @live-db): like the tutor chat-reply spec, it also
// writes the DB, but an LLM test implies the DB — tagging it @live-db too would
// make a `--grep @live-db`-only run (CI) select it and fail without the LLM.
test("author → code → answer → discuss", { tag: ["@live", "@live-llm"] }, async ({ page }) => {
  test.setTimeout(180_000);

  const name = `e2e-quiz-${Date.now()}`;

  // 1. Author the quiz file (kind=quiz → structurally validated, then stored).
  await page.goto("/files/new");
  await page.getByLabel(/Name/).fill(name);
  await page.getByLabel("Kind").selectOption("quiz");
  await setEditorContent(page, SAMPLE_QUIZ);
  await page.getByRole("button", { name: "Validate & create" }).click();
  await expect(page).toHaveURL(new RegExp(`/files/edit/${name}$`), { timeout: 60_000 });

  // 2. Mint a quiz code pointing at the authored file's public URL.
  const quizUrl = `${new URL(page.url()).origin}/api/files/${name}`;
  const code = await mintCode({ module: "quiz", file: quizUrl });

  // 3. Open the quiz at /<code>: answer the question and get a verdict.
  await page.goto(`/${code}`);
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

  await sendAndExpectReply(page, { message: "Why is that the capital?" });

  // 5. Clean up the quiz file (no automatic GC; the minted code lingers like the
  // other mint-and-leave specs — harmless and tidied with the CI container).
  await page.goto(`/files/edit/${name}`);
  page.once("dialog", (dialog) => dialog.accept());
  const del = page.getByRole("button", { name: /delete/i }).first();
  if (await del.isVisible().catch(() => false)) await del.click();
});
