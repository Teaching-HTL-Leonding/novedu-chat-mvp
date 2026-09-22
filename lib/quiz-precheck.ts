import type { PrecheckHint, QuizVerdict } from "@/lib/quiz-types";
import type { QuizQuestion } from "@/lib/quiz-yaml";

// The live pre-check's PURE core: the tunable constants, the request the
// classifier (Jev, see lib/llm/jev-client.ts) is asked, and the mapping from its
// answer to the student-facing hint. No I/O, no env, no SDK.
//
// CLIENT-SAFE ON PURPOSE: the browser hook imports `PRECHECK_DEBOUNCE_MS` and
// `PRECHECK_MAX_ANSWER_CHARS` so the client's rules and the server's are ONE
// definition rather than two that drift. That is why this module imports NOTHING
// at runtime — only `import type` from `@/lib/quiz-types` and `@/lib/quiz-yaml`
// (the latter's `QuizQuestion` type alone; the YAML parser never reaches the
// bundle). It must never import `@typesafe-ai/sdk`, anything under `lib/llm/`,
// `app/**` or the DB, and must never carry a `"use server"` directive — the
// `evaluation` prompt it reads is server-only and stays on the server: only the
// finished request object crosses into the Jev client, and only the hint comes
// back out (a purity guard in the unit test enforces the import list).

/** The text must be unchanged this long before a check goes out (client-side debounce). */
export const PRECHECK_DEBOUNCE_MS = 1000;

/** Below this reported confidence the hint degrades to `unsure` rather than guessing. */
export const PRECHECK_MIN_CONFIDENCE = 0.5;

/** Longer answers are not pre-checked at all — enforced on BOTH sides (client + action). */
export const PRECHECK_MAX_ANSWER_CHARS = 4000;

/**
 * The classifier's state, structured so the instructions can name its fields.
 * A local structural type — the wire shape is plain data, so this module needs no
 * SDK import and `askJev` accepts it structurally. A type ALIAS rather than an
 * interface on purpose: the SDK's `state` is a JSON value, and only an alias
 * carries the implicit index signature that makes this assignable to one.
 */
export type PrecheckState = {
  question: string;
  grading_notes: string;
  student_answer: string;
};

/** One Choice question, keyed by the internal `QuizVerdict` vocabulary. */
export interface PrecheckChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<QuizVerdict, string>;
}

/** The whole `systemOne` request: the state plus the single `verdict` question. */
export interface PrecheckRequest {
  state: PrecheckState;
  questions: { verdict: PrecheckChoiceQuestion };
}

// Jev reads LITERALLY and does not reason, so the instructions say exactly which
// state field is the student's text, which one is the rubric, and that the notes'
// own "give the student feedback" wording is NOT an instruction to follow — the
// notes were written for a chat grader that answers in prose, while the pre-check
// only picks a label.
const PRECHECK_INSTRUCTIONS =
  "`student_answer` is a student's answer to `question`, possibly still being typed. " +
  "`grading_notes` were written for a grader: they state the expected answer and the " +
  "rubric. Judge `student_answer` against `grading_notes` only; ignore the notes' " +
  "instructions about giving feedback.";

// The criteria carry the boundary cases explicitly (Jev does not infer them): a
// half-typed but so-far-right start is `partial`, not `incorrect`, and text that
// is not an attempt at all lands on `incorrect` rather than forcing a guess.
const PRECHECK_CRITERIA: Record<QuizVerdict, string> = {
  correct: "meets the `correct` level in `grading_notes`",
  partial:
    "meets the `partial` level in `grading_notes`, or is an incomplete but so far correct start",
  incorrect: "meets the `incorrect` level in `grading_notes`, or is not an attempt at the question",
};

/**
 * Builds the one request the pre-check sends per check.
 *
 * `grading_notes` is the question's server-only `evaluation`, prefixed by the
 * `sourcePreamble` when the question came in through `quiz_files` (so an imported
 * question is judged by its own chapter's rules, exactly as the grader does).
 *
 * The quiz-level `instructionsPreamble` is deliberately NOT sent: it is
 * persona/safety text for a chat grader, and irrelevant state measurably costs
 * this classifier accuracy.
 */
export function buildPrecheckRequest(question: QuizQuestion, answer: string): PrecheckRequest {
  const preamble = question.sourcePreamble ? `${question.sourcePreamble}\n\n` : "";
  return {
    state: {
      question: question.question,
      grading_notes: `${preamble}${question.evaluation}`,
      student_answer: answer,
    },
    questions: {
      verdict: {
        type: "choice",
        instructions: PRECHECK_INSTRUCTIONS,
        criteria: PRECHECK_CRITERIA,
      },
    },
  };
}

/**
 * Turns the classifier's answer into the hint the student sees. A label the model
 * is not sure enough about becomes `unsure` — showing a confident-looking green
 * icon on a coin flip would be worse than showing nothing definite. The confidence
 * itself never leaves the server.
 */
export function mapPrecheckAnswer(choice: QuizVerdict, confidence: number): PrecheckHint {
  return { verdict: confidence < PRECHECK_MIN_CONFIDENCE ? "unsure" : choice };
}
