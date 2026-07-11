import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { ResolvedQuiz } from "@/lib/quiz-types";

// The quiz runner's PHOTO-ANSWER surface (app/[code]/_quiz/quiz-runner.tsx):
// the Add-photo control is offered only on questions whose effective
// `imageInput` is true, picked files run through the shared client validation
// (lib/answer-images.ts), and Submit gates on text OR ≥1 photo. The grading /
// discussion server actions are mocked; the in-page discussion chat (CopilotKit)
// is stubbed out. The server-side re-validation lives in
// lib/quiz-actions.unit.test.ts.

const submitAnswer = vi.hoisted(() => vi.fn());
const startDiscussion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/quiz-actions", () => ({ submitAnswer, startDiscussion }));

vi.mock("@/app/[code]/_quiz/quiz-discussion", () => ({
  QuizDiscussion: () => <div data-testid="quiz-discussion">chat</div>,
}));

import { QuizRunner } from "@/app/[code]/_quiz/quiz-runner";

const CODE = "a1b2c3d4e5";

// Drives the HIDDEN file input directly (the test runs inside the browser):
// a real DataTransfer + a bubbling `change` event reaches React's delegated
// onChange, exactly like a native pick — no visibility check to fight.
function attachFiles(input: HTMLInputElement, ...files: File[]) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function quizWith(imageInput: boolean): ResolvedQuiz {
  return {
    id: "q",
    shuffle: false,
    questions: [{ id: "q1", question: "What is **2 + 2**?", imageInput }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  submitAnswer.mockResolvedValue({ ok: true, result: "correct", feedback: "Well done." });
});

// cleanup() is ASYNC (it act-unmounts every root) — an unawaited call leaks
// IS_REACT_ACT_ENVIRONMENT into the next test, and then the state update from
// the file input's change event queues forever instead of flushing.
afterEach(async () => {
  await cleanup();
});

test("offers Add photo only on imageInput questions", async () => {
  const withPhotos = await render(<QuizRunner code={CODE} quiz={quizWith(true)} />);
  await expect.element(withPhotos.getByRole("button", { name: "Add photo" })).toBeVisible();
  await cleanup();

  const withoutPhotos = await render(<QuizRunner code={CODE} quiz={quizWith(false)} />);
  await expect.element(withoutPhotos.getByRole("button", { name: "Submit answer" })).toBeVisible();
  expect(withoutPhotos.getByRole("button", { name: "Add photo" }).query()).toBeNull();
});

test("Submit gates on text OR at least one photo", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizWith(true)} />);
  const submit = screen.getByRole("button", { name: "Submit answer" });
  await expect.element(submit).toBeDisabled();

  await screen.getByRole("textbox").fill("4");
  await expect.element(submit).toBeEnabled();

  await screen.getByRole("textbox").fill("   ");
  await expect.element(submit).toBeDisabled();
});

test("an image-only answer submits the photo as a data URL", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizWith(true)} />);
  // The runner renders a "Preparing quiz…" placeholder until its mount effect
  // applies the question order — wait for the real card before grabbing the input.
  await expect.element(screen.getByRole("button", { name: "Add photo" })).toBeVisible();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not rendered");

  attachFiles(input, new File(["fake-pixels"], "sketch.png", { type: "image/png" }));

  // The accepted photo renders as a removable thumbnail and enables Submit.
  await expect.element(screen.getByAltText("sketch.png")).toBeVisible();
  const submit = screen.getByRole("button", { name: "Submit answer" });
  await expect.element(submit).toBeEnabled();

  await submit.click();
  await expect.element(screen.getByText("Well done.")).toBeVisible();
  expect(submitAnswer).toHaveBeenCalledExactlyOnceWith({
    code: CODE,
    questionId: "q1",
    answer: "",
    images: [expect.stringMatching(/^data:image\/png;base64,/)],
  });

  // The answered card keeps showing the photo.
  await expect.element(screen.getByAltText("sketch.png")).toBeVisible();
});

test("removing the only photo disables Submit again", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizWith(true)} />);
  // The runner renders a "Preparing quiz…" placeholder until its mount effect
  // applies the question order — wait for the real card before grabbing the input.
  await expect.element(screen.getByRole("button", { name: "Add photo" })).toBeVisible();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not rendered");

  attachFiles(input, new File(["fake-pixels"], "sketch.png", { type: "image/png" }));
  await expect.element(screen.getByRole("button", { name: "Submit answer" })).toBeEnabled();

  await screen.getByRole("button", { name: "Remove photo sketch.png" }).click();
  expect(screen.getByAltText("sketch.png").query()).toBeNull();
  await expect.element(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
});

test("a rejected file shows a dismissible notice and does not enable Submit", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizWith(true)} />);
  // The runner renders a "Preparing quiz…" placeholder until its mount effect
  // applies the question order — wait for the real card before grabbing the input.
  await expect.element(screen.getByRole("button", { name: "Add photo" })).toBeVisible();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not rendered");

  attachFiles(input, new File(["not an image"], "notes.txt", { type: "text/plain" }));

  const notice = screen.getByRole("alert");
  await expect.element(notice).toBeVisible();
  await expect.element(notice).toHaveTextContent("notes.txt: only image files can be added.");
  await expect.element(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();

  await screen.getByRole("button", { name: "Dismiss" }).click();
  expect(screen.getByRole("alert").query()).toBeNull();
});
