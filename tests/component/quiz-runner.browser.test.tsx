import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { ResolvedQuiz } from "@/lib/quiz-types";

// The quiz runner's PHOTO-ANSWER surface (app/[code]/_quiz/quiz-runner.tsx):
// the Add-photo control is offered only on questions whose effective
// `imageInput` is true, picked files run through the shared client validation
// (lib/answer-images.ts), and Submit gates on text OR ≥1 photo — plus the core
// WALK loop (answer → verdict → Next → Finish → summary) and the sequence
// WIRING: the runner renders exactly what `buildQuestionSequence` returns and
// labels progress from its length. The sequence SEMANTICS (shuffle passes,
// question_count truncation/repeats) live in lib/quiz-sequence.unit.test.ts —
// here the builder is stubbed (pass-through by default). The grading /
// discussion server actions are mocked; the in-page discussion chat (CopilotKit)
// is stubbed out. The server-side re-validation lives in
// lib/quiz-actions.unit.test.ts.

const submitAnswer = vi.hoisted(() => vi.fn());
const startDiscussion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/quiz-actions", () => ({ submitAnswer, startDiscussion }));

const buildQuestionSequence = vi.hoisted(() => vi.fn());
vi.mock("@/lib/quiz-sequence", () => ({ buildQuestionSequence }));

vi.mock("@/app/[code]/_quiz/quiz-discussion", () => ({
  QuizDiscussion: () => <div data-testid="quiz-discussion">chat</div>,
}));

// The verdict card mounts the shared ReportButton, which statically imports the
// report server actions; mock them so the browser bundle doesn't pull next/cache.
vi.mock("@/lib/report-actions", () => ({ submitChatReport: vi.fn(), submitQuizReport: vi.fn() }));

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
    questionCount: 1,
    questions: [{ id: "q1", question: "What is **2 + 2**?", imageInput }],
  };
}

/** A plain n-question quiz for the walk tests (no photos). */
function quizOf(n: number): ResolvedQuiz {
  const questions = Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    question: `QUESTION-${i + 1}`,
    imageInput: false,
  }));
  return { id: "q", shuffle: false, questionCount: n, questions };
}

beforeEach(() => {
  vi.clearAllMocks();
  submitAnswer.mockResolvedValue({ ok: true, result: "correct", feedback: "Well done." });
  // Pass-through by default: the runner walks the pool in order. Individual tests
  // override the return value to assert the wiring.
  buildQuestionSequence.mockImplementation((pool: unknown[]) => [...pool]);
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

/**
 * A REAL image, built here rather than faked: photos now go through
 * `normalizeStudentImage`, which decodes every pick — a File of arbitrary bytes
 * with an image MIME type is exactly what the normalizer is meant to reject.
 */
async function realPng(name: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, 24, 24);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("toBlob failed");
  return new File([blob], name, { type: "image/png" });
}

test("an image-only answer submits the photo as a data URL", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizWith(true)} />);
  // The runner renders a "Preparing quiz…" placeholder until its mount effect
  // applies the question order — wait for the real card before grabbing the input.
  await expect.element(screen.getByRole("button", { name: "Add photo" })).toBeVisible();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not rendered");

  attachFiles(input, await realPng("sketch.png"));

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

  attachFiles(input, await realPng("sketch.png"));
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
  // The message names what the bytes turned out to be, not merely that
  // something failed — that specificity is the point of the sniffing step.
  await expect.element(notice).toHaveTextContent("notes.txt: This file could not be opened");
  await expect.element(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();

  await screen.getByRole("button", { name: "Dismiss" }).click();
  expect(screen.getByRole("alert").query()).toBeNull();
});

// --- sequence wiring + the core walk loop ------------------------------------------

test("renders exactly the sequence buildQuestionSequence returns, progress from its length", async () => {
  const quiz = quizOf(2);
  quiz.questionCount = 3; // drill mode: 3 asked from a pool of 2
  const [q1, q2] = quiz.questions;
  buildQuestionSequence.mockReturnValue([q2, q1, q2]);

  const screen = await render(<QuizRunner code={CODE} quiz={quiz} />);
  // The runner hands the POOL + its shuffle/count knobs to the builder…
  await expect.element(screen.getByText("Question 1 of 3")).toBeVisible();
  expect(buildQuestionSequence).toHaveBeenCalledExactlyOnceWith(quiz.questions, {
    shuffle: false,
    count: 3,
  });
  // …and shows the builder's first pick (q2), not the authored first question.
  await expect.element(screen.getByText("QUESTION-2")).toBeVisible();
});

test("walks the quiz: verdict labels, Next advances, Finish ends in the summary", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(3)} />);

  // Q1: correct.
  await expect.element(screen.getByText("Question 1 of 3")).toBeVisible();
  submitAnswer.mockResolvedValueOnce({ ok: true, result: "correct", feedback: "FB-1" });
  await screen.getByRole("textbox").fill("a1");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await expect.element(screen.getByRole("heading", { name: "correct" })).toBeVisible();
  await expect.element(screen.getByText("FB-1")).toBeVisible();

  // Next advances to Q2 with a cleared answer box.
  await screen.getByRole("button", { name: "Next question" }).click();
  await expect.element(screen.getByText("Question 2 of 3")).toBeVisible();
  await expect.element(screen.getByText("QUESTION-2")).toBeVisible();
  await expect.element(screen.getByRole("textbox")).toHaveValue("");

  // Q2: partly correct.
  submitAnswer.mockResolvedValueOnce({ ok: true, result: "partial", feedback: "FB-2" });
  await screen.getByRole("textbox").fill("a2");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await expect.element(screen.getByRole("heading", { name: "partly correct" })).toBeVisible();
  await screen.getByRole("button", { name: "Next question" }).click();

  // Q3 (last): wrong; the advance button reads "Finish" and ends in the summary.
  await expect.element(screen.getByText("Question 3 of 3")).toBeVisible();
  submitAnswer.mockResolvedValueOnce({ ok: true, result: "incorrect", feedback: "FB-3" });
  await screen.getByRole("textbox").fill("a3");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await expect.element(screen.getByRole("heading", { name: "wrong" })).toBeVisible();
  await screen.getByRole("button", { name: "Finish" }).click();

  await expect.element(screen.getByRole("heading", { name: "Quiz summary" })).toBeVisible();
  await expect.element(screen.getByText("You answered 3 of 3 questions.")).toBeVisible();
});

test("Finish now ends the quiz early with the partial tally", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(3)} />);

  submitAnswer.mockResolvedValueOnce({ ok: true, result: "correct", feedback: "FB-1" });
  await screen.getByRole("textbox").fill("a1");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await expect.element(screen.getByRole("heading", { name: "correct" })).toBeVisible();

  await screen.getByRole("button", { name: "Finish now" }).click();
  await expect.element(screen.getByRole("heading", { name: "Quiz summary" })).toBeVisible();
  await expect.element(screen.getByText("You answered 1 of 3 questions.")).toBeVisible();
});
