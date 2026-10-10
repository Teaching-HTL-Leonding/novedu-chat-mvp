import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { sendAndExpectReply } from "./chat.utils";
import { mintCode } from "./code.utils";
import { setEditorContent } from "./page.utils";

// End-to-end coverage for the Quizzes feature, reached as CODES (a `novedu_codes`
// row with `module: "quiz"`) at `/<code>`.
// Both tests need the DB (@live-db, run in CI). The full author → code → answer →
// discuss flow grades and discusses through the fake LLM (docs/testing.md, "Fake
// LLM"): the grader answers `correct`, the discussion gets the fake's echo.
//
// CopilotKit v2 testids (shared with the tutor chat): copilot-chat-textarea,
// copilot-send-button, copilot-user-message, copilot-assistant-message.

test.use({ storageState: TEACHER_STORAGE_STATE });

// A tiny one-question quiz so the grade + discussion stay fast.
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

// A quiz code outside its window is refused exactly like any other code — the
// shared window check fires before the quiz is ever loaded, so this needs the DB
// (to mint the row) but no LLM.
test("an expired quiz code shows the window-error notice", { tag: ["@live", "@live-db"] }, async ({
  page,
}) => {
  // The file URL is never fetched — the expiry check rejects first.
  const code = await mintCode({
    module: "quiz",
    file: "https://example.com/api/files/never-loaded",
    endOffset: -10,
  });
  await page.goto(`/${code}`);

  await expect(page.getByRole("heading", { name: "Code expired" })).toBeVisible();
});

// The full flow: author a quiz file, mint a quiz CODE for it, open it, get a
// graded verdict, and run a discussion turn.
test("author → code → answer → discuss", { tag: ["@live", "@live-db"] }, async ({ page }) => {
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
  await expect(answer).toBeVisible();
  await answer.fill("The capital of Austria is Vienna.");
  await page.getByRole("button", { name: "Submit answer" }).click();

  // The fake grader's default verdict, with its feedback.
  await expect(page.getByRole("heading", { name: "correct", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Fake LLM verdict: correct.")).toBeVisible();

  // 4. Open the discussion. It opens in a modal <dialog> that shows the graded
  // feedback at the top (not the full seeded conversation), then accepts a
  // follow-up that must get a reply.
  await page.getByRole("button", { name: "Chat about this" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await sendAndExpectReply(page, { message: "Why is that the capital?" });
  await expect(dialog.getByTestId("copilot-assistant-message").last()).toContainText(
    "You wrote: Why is that the capital?",
  );
});
