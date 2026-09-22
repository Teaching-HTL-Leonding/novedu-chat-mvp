import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { ResolvedQuiz } from "@/lib/quiz-types";

// The quiz runner's PHOTO-ANSWER surface (app/[code]/_quiz/quiz-runner.tsx):
// the Add-photo control is offered only on questions whose effective
// `imageInput` is true, picked files run through the shared client validation
// (lib/answer-images.ts), and Submit gates on text OR ≥1 photo — plus the core
// WALK loop (answer → verdict → Next → Finish → summary) and the sequence
// WIRING: the runner renders exactly what `buildQuestionSequence` returns and
// labels progress from its length — and the SKIP surface (a skipped question
// returns later with its draft; skips never reach the server). The sequence
// SEMANTICS (shuffle passes, question_count truncation/repeats) live in
// lib/quiz-sequence.unit.test.ts and the walk/skip rules in
// lib/quiz-attempt.unit.test.ts (used for real here) — the builder is stubbed
// (pass-through by default). The grading /
// discussion server actions are mocked; the in-page discussion chat (CopilotKit)
// is stubbed out. The server-side re-validation lives in
// lib/quiz-actions.unit.test.ts.
//
// Plus the LIVE PRE-CHECK surface (the `useAnswerPrecheck` hook +
// `PrecheckIndicator`): when the action is asked, when it is deliberately not,
// and what the student sees. REAL timers throughout — no test in `tests/` fakes
// them, and `expect.element`'s polling needs the clock to run — so a negative
// assertion waits out a slice of the debounce window and a positive one polls.
// The 1000 ms window is mocked to its real value below, which is what makes
// "wait 400 ms, still nothing" meaningful.

const submitAnswer = vi.hoisted(() => vi.fn());
const startDiscussion = vi.hoisted(() => vi.fn());
const precheckAnswer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/quiz-actions", () => ({ submitAnswer, startDiscussion, precheckAnswer }));

// The hook's two tunables, pinned here: the timings every assertion below is
// written against are these, not whatever the module happens to hold.
vi.mock("@/lib/quiz-precheck", () => ({
  PRECHECK_DEBOUNCE_MS: 1000,
  PRECHECK_MAX_ANSWER_CHARS: 4000,
}));

const buildQuestionSequence = vi.hoisted(() => vi.fn());
vi.mock("@/lib/quiz-sequence", () => ({ buildQuestionSequence }));

vi.mock("@/app/[code]/_quiz/quiz-discussion", () => ({
  QuizDiscussion: () => <div data-testid="quiz-discussion">chat</div>,
}));

// The verdict card mounts the shared ReportButton, which statically imports the
// report server actions; mock them so the browser bundle doesn't pull next/cache.
vi.mock("@/lib/report-actions", () => ({ submitChatReport: vi.fn(), submitQuizReport: vi.fn() }));

import { PRECHECK_LABELS, precheckHintText } from "@/app/[code]/_quiz/precheck-indicator";
import { QuizRunner } from "@/app/[code]/_quiz/quiz-runner";

const CODE = "a1b2c3d4e5";

/** A slice of the debounce window: proves nothing went out immediately. */
const WITHIN_WINDOW = 400;
/** Comfortably past one window: proves nothing was scheduled at all. */
const PAST_WINDOW = 1500;
/** Waiting out a window needs more than the 1000 ms default of both helpers. */
const POLL = { timeout: 3000 };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    immediateFeedback: true,
    questions: [{ id: "q1", question: "What is **2 + 2**?", imageInput }],
  };
}

/**
 * A plain n-question quiz for the walk tests (no photos). `immediateFeedback` is
 * the EFFECTIVE flag the server computed — false is the per-quiz opt-out.
 */
function quizOf(n: number, immediateFeedback = true): ResolvedQuiz {
  const questions = Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    question: `QUESTION-${i + 1}`,
    imageInput: false,
  }));
  return { id: "q", shuffle: false, questionCount: n, immediateFeedback, questions };
}

beforeEach(() => {
  vi.clearAllMocks();
  submitAnswer.mockResolvedValue({ ok: true, result: "correct", feedback: "Well done." });
  precheckAnswer.mockResolvedValue({ ok: true, hint: { verdict: "correct" } });
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

// --- skipping ---------------------------------------------------------------------

test("Skip moves the question to the back of the line; it returns after the rest", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(3)} />);

  await expect.element(screen.getByText("QUESTION-1")).toBeVisible();
  await screen.getByRole("button", { name: "Skip for now" }).click();

  // Q2 is next; skipping neither advances the progress number nor grades anything.
  await expect.element(screen.getByText("QUESTION-2")).toBeVisible();
  await expect.element(screen.getByText("Question 1 of 3 · 1 skipped for later")).toBeVisible();
  expect(submitAnswer).not.toHaveBeenCalled();

  await screen.getByRole("textbox").fill("a2");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await screen.getByRole("button", { name: "Next question" }).click();

  await expect.element(screen.getByText("QUESTION-3")).toBeVisible();
  await screen.getByRole("textbox").fill("a3");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await screen.getByRole("button", { name: "Next question" }).click();

  // The skipped question comes back last, marked, and can no longer be skipped.
  await expect.element(screen.getByText("QUESTION-1")).toBeVisible();
  await expect.element(screen.getByText("Question 3 of 3 · skipped earlier")).toBeVisible();
  expect(screen.getByRole("button", { name: "Skip for now" }).query()).toBeNull();

  await screen.getByRole("textbox").fill("a1");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await screen.getByRole("button", { name: "Finish" }).click();
  await expect.element(screen.getByText("You answered 3 of 3 questions.")).toBeVisible();
  expect(submitAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ questionId: "q1" }));
});

test("a skipped question's draft answer is restored when it returns", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(2)} />);

  await screen.getByRole("textbox").fill("half an idea");
  await screen.getByRole("button", { name: "Skip for now" }).click();
  await expect.element(screen.getByText("QUESTION-2")).toBeVisible();
  await expect.element(screen.getByRole("textbox")).toHaveValue("");

  await screen.getByRole("textbox").fill("a2");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await screen.getByRole("button", { name: "Next question" }).click();

  await expect.element(screen.getByText("QUESTION-1")).toBeVisible();
  await expect.element(screen.getByRole("textbox")).toHaveValue("half an idea");
});

test("the last remaining question offers no Skip", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("button", { name: "Submit answer" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Skip for now" }).query()).toBeNull();
});

test("finishing with skipped questions left reports them in the summary", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(3)} />);

  await screen.getByRole("button", { name: "Skip for now" }).click();
  await expect.element(screen.getByText("QUESTION-2")).toBeVisible();
  await screen.getByRole("button", { name: "Skip for now" }).click();
  await expect.element(screen.getByText("QUESTION-3")).toBeVisible();
  await screen.getByRole("textbox").fill("a3");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await screen.getByRole("button", { name: "Finish now" }).click();

  await expect
    .element(
      screen.getByText("You answered 1 of 3 questions. 2 skipped questions were not answered."),
    )
    .toBeVisible();
});

// --- the live pre-check hint --------------------------------------------------------

test("never pre-checks an empty or whitespace-only answer", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();

  await screen.getByRole("textbox").fill("   ");
  await wait(PAST_WINDOW);
  expect(precheckAnswer).not.toHaveBeenCalled();
}, 10000);

test("asks once, after a full quiet window, with the trimmed answer", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();

  await screen.getByRole("textbox").fill("  4 is the answer  ");
  // Nothing goes out while the student may still be typing…
  await wait(WITHIN_WINDOW);
  expect(precheckAnswer).not.toHaveBeenCalled();

  // …and exactly one call once the text has been quiet for the whole window.
  await expect.poll(() => precheckAnswer.mock.calls.length, POLL).toBe(1);
  expect(precheckAnswer).toHaveBeenCalledWith({
    code: CODE,
    questionId: "q1",
    answer: "4 is the answer",
  });
  await expect
    .element(screen.getByRole("status", { name: precheckHintText("correct") }), POLL)
    .toBeVisible();
}, 10000);

// One pill (icon + label) per hint state, each carrying the same sentence in `title`
// (the app's tooltip convention) and `aria-label` — each saying "hint", never "grade".
for (const verdict of ["correct", "partial", "incorrect", "unsure"] as const) {
  test(`shows the ${verdict} hint as icon + label with its tooltip`, async () => {
    precheckAnswer.mockResolvedValue({ ok: true, hint: { verdict } });
    const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
    await expect.element(screen.getByRole("textbox")).toBeVisible();

    await screen.getByRole("textbox").fill("an answer in progress");

    const text = precheckHintText(verdict);
    const pill = screen.getByRole("status", { name: text });
    await expect.element(pill, POLL).toBeVisible();
    await expect.element(pill).toHaveTextContent(PRECHECK_LABELS[verdict]);
    await expect.element(pill).toHaveAttribute("title", text);
    await expect.element(pill).toHaveAttribute("aria-label", text);
  }, 10000);
}

test("typing again dims the hint until a fresh one replaces it", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();

  await screen.getByRole("textbox").fill("first");
  const hint = screen.getByRole("status", { name: precheckHintText("correct") });
  await expect.element(hint, POLL).toBeVisible();
  await expect.element(hint).not.toHaveClass("opacity-50");

  // A dimmed hint about the text the student just left beats both a blank slot
  // and a spinner that throws the hint away.
  precheckAnswer.mockResolvedValue({ ok: true, hint: { verdict: "incorrect" } });
  await screen.getByRole("textbox").fill("first, extended");
  await expect.element(hint).toHaveClass("opacity-50");

  const replaced = screen.getByRole("status", { name: precheckHintText("incorrect") });
  await expect.element(replaced, POLL).toBeVisible();
  await expect.element(replaced).not.toHaveClass("opacity-50");
}, 15000);

test("survives burst typing with a hint on screen — no nested-update overflow", async () => {
  // Regression: the hook's effect runs on every keystroke, and React counts an
  // update dispatched from inside a passive-effect flush as a NESTED update. An
  // early version re-dispatched the stale marker (a fresh object) per keystroke,
  // which fast typing turned into React's hard "Maximum update depth exceeded"
  // error (seen live). The effect must only write on a real transition, so a
  // long burst after a hint exists must neither throw nor ask more than once
  // more.
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();
  await screen.getByRole("textbox").fill("seed");
  await expect
    .element(screen.getByRole("status", { name: precheckHintText("correct") }), POLL)
    .toBeVisible();

  // One native input event per character, dispatched back to back the way an
  // automation client (or a fast IME) does — `fill` would be a single event and
  // `userEvent.type` paces keys through the event loop, neither of which
  // reproduces the overflow.
  const burst = " and then a long burst of text ".repeat(6);
  const textarea = screen.getByRole("textbox").element() as HTMLTextAreaElement;
  textarea.focus();
  for (const ch of burst) document.execCommand("insertText", false, ch);
  await expect.element(screen.getByRole("textbox")).toHaveValue(`seed${burst}`);
  await expect.poll(() => precheckAnswer.mock.calls.length, POLL).toBe(2);
}, 30000);

test("drops a pre-check response that is no longer the latest", async () => {
  // A server action cannot be aborted, so a superseded call still answers — the
  // hook must ignore it rather than let it overwrite the current hint.
  const pending: Array<(result: unknown) => void> = [];
  precheckAnswer.mockImplementation(
    () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  );
  const answerCall = (index: number, verdict: string) => {
    const resolve = pending[index];
    if (!resolve) throw new Error(`pre-check call ${index} was never made`);
    resolve({ ok: true, hint: { verdict } });
  };

  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();

  await screen.getByRole("textbox").fill("one");
  await expect.poll(() => pending.length, POLL).toBe(1);
  await screen.getByRole("textbox").fill("one two");
  await expect.poll(() => pending.length, POLL).toBe(2);

  // The SECOND call answers first…
  answerCall(1, "partial");
  const shown = screen.getByRole("status", { name: precheckHintText("partial") });
  await expect.element(shown, POLL).toBeVisible();

  // …so the first call's late answer must not replace it.
  answerCall(0, "incorrect");
  await wait(WITHIN_WINDOW);
  expect(screen.getByRole("status", { name: precheckHintText("incorrect") }).query()).toBeNull();
  await expect.element(shown).toBeVisible();
}, 15000);

test("asks for no hint while the answer is being graded", async () => {
  submitAnswer.mockImplementation(() => new Promise(() => {})); // never settles
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();

  await screen.getByRole("textbox").fill("a1");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await expect.element(screen.getByRole("button", { name: "Checking…" })).toBeVisible();

  // Submitting lands inside the quiet window, and grading keeps it closed.
  expect(precheckAnswer).not.toHaveBeenCalled();
  await wait(PAST_WINDOW);
  expect(precheckAnswer).not.toHaveBeenCalled();
}, 10000);

test("a quiz with immediate feedback switched off never asks", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1, false)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();

  await screen.getByRole("textbox").fill("an answer");
  await wait(PAST_WINDOW);
  expect(precheckAnswer).not.toHaveBeenCalled();
  expect(screen.getByRole("status", { name: precheckHintText("correct") }).query()).toBeNull();
}, 10000);

test("retyping already-checked text restores its hint without asking again", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();
  const box = screen.getByRole("textbox");

  await box.fill("x");
  const hint = screen.getByRole("status", { name: precheckHintText("correct") });
  await expect.element(hint, POLL).toBeVisible();
  expect(precheckAnswer).toHaveBeenCalledExactlyOnceWith({
    code: CODE,
    questionId: "q1",
    answer: "x",
  });

  await box.fill("xy"); // dims the hint and opens a new window…
  await expect.element(hint).toHaveClass("opacity-50");
  await box.fill("x"); // …which going back to the known text abandons
  await expect.element(hint).not.toHaveClass("opacity-50");

  await wait(PAST_WINDOW);
  expect(precheckAnswer).toHaveBeenCalledOnce();
}, 15000);

test("a refused pre-check shows nothing — no icon and no error", async () => {
  precheckAnswer.mockResolvedValue({ ok: false });
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(1)} />);
  await expect.element(screen.getByRole("textbox")).toBeVisible();

  await screen.getByRole("textbox").fill("an answer");
  await expect.poll(() => precheckAnswer.mock.calls.length, POLL).toBe(1);
  await wait(WITHIN_WINDOW);

  expect(screen.getByRole("status").query()).toBeNull();
  expect(screen.getByRole("alert").query()).toBeNull();
}, 10000);

test("Skip clears the hint; the restored draft is checked again on return", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(2)} />);
  await expect.element(screen.getByText("QUESTION-1")).toBeVisible();

  await screen.getByRole("textbox").fill("alpha");
  const hint = screen.getByRole("status", { name: precheckHintText("correct") });
  await expect.element(hint, POLL).toBeVisible();

  await screen.getByRole("button", { name: "Skip for now" }).click();
  await expect.element(screen.getByText("QUESTION-2")).toBeVisible();
  expect(hint.query()).toBeNull();

  await screen.getByRole("textbox").fill("beta");
  await screen.getByRole("button", { name: "Submit answer" }).click();
  await screen.getByRole("button", { name: "Next question" }).click();

  // The draft comes back WITHOUT its old hint (there is no per-slot cache) and
  // earns a fresh one after one quiet window.
  await expect.element(screen.getByText("QUESTION-1")).toBeVisible();
  await expect.element(screen.getByRole("textbox")).toHaveValue("alpha");
  expect(hint.query()).toBeNull();

  const before = precheckAnswer.mock.calls.length;
  await expect.poll(() => precheckAnswer.mock.calls.length, POLL).toBe(before + 1);
  expect(precheckAnswer).toHaveBeenLastCalledWith({
    code: CODE,
    questionId: "q1",
    answer: "alpha",
  });
  await expect.element(hint, POLL).toBeVisible();
}, 20000);

test("Next question leaves no hint behind on the fresh answer box", async () => {
  const screen = await render(<QuizRunner code={CODE} quiz={quizOf(2)} />);
  await expect.element(screen.getByText("QUESTION-1")).toBeVisible();

  await screen.getByRole("textbox").fill("a1");
  const hint = screen.getByRole("status", { name: precheckHintText("correct") });
  await expect.element(hint, POLL).toBeVisible();

  await screen.getByRole("button", { name: "Submit answer" }).click();
  await expect.element(screen.getByRole("heading", { name: "correct" })).toBeVisible();
  await screen.getByRole("button", { name: "Next question" }).click();

  await expect.element(screen.getByText("QUESTION-2")).toBeVisible();
  expect(hint.query()).toBeNull();

  // An empty answer box asks for nothing, on this question as on the first.
  const before = precheckAnswer.mock.calls.length;
  await wait(PAST_WINDOW);
  expect(precheckAnswer.mock.calls.length).toBe(before);
}, 20000);
