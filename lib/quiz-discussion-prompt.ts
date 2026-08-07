import { type QuizVerdict, verdictLabel } from "@/lib/quiz-types";
import type { Quiz } from "@/lib/quiz-yaml";

// The quiz DISCUSSION prompt surface: the system prompt the `quizDiscussion` agent runs
// with, plus the templates of the three messages `startDiscussion` seeds the thread's
// memory with (question / answer / verdict+feedback).
//
// Extracted from `lib/code-modules/quiz.ts` (which imports `app/mastra/quiz-agents.ts`)
// and `lib/quiz-actions.ts` (a `"use server"` module) so exactly ONE definition serves
// both the runtime and the prompt dump (`lib/prompt-dump.ts`,
// `@novedu/cli prompts --kind quiz`) — a copy would silently drift.
//
// PURE / CLI-safe: no I/O, no `"use server"`, no `app/`, no DB, no `lib/llm/**`
// (`lib/prompt-dump.unit.test.ts` guards it).

/**
 * The discussion chat's system prompt: the quiz-level `instructionsPreamble` (the
 * rendered `instructions` host text — shared safety/persona/language rules, the SAME
 * preamble the grader receives) followed by a default frame and the quiz's optional
 * `discussionInstructions`. The question/answer/verdict are the thread's seed messages,
 * recalled from memory, NOT repeated here.
 *
 * A compound quiz's imported questions each carry their SOURCE quiz's preamble
 * (`sourcePreamble`), but that applies to GRADING only (`buildGradingPrompt`): the
 * discussion prompt uses ONLY the compound file's own instructions — consistent with
 * every other include-level field (`llm`, `anonymous`, `shuffle`, ...), which the
 * compound file governs too. Mixing all chapters' preambles into one prompt would put
 * conflicting persona/language rules in force at once; the question/answer/verdict the
 * discussion needs are recalled from the thread's seed messages regardless.
 */
export function buildDiscussionInstructions(quiz: Quiz): string {
  const base =
    "You are helping a student understand a single quiz question. The conversation " +
    "already contains the question, the student's submitted answer, and the verdict " +
    "with feedback — use that context. Be concise and encouraging, and stay on this " +
    "question.";
  const frame = quiz.discussionInstructions
    ? `${base}\n\n${quiz.discussionInstructions.trim()}`
    : base;
  // Compound preamble → frame; empty pieces drop out.
  return [quiz.instructionsPreamble, frame].filter(Boolean).join("\n\n");
}

/**
 * Seed message 1 (assistant): the question, as the SERVER knows it (authoritative).
 * `{question}` is the question's trimmed markdown.
 */
export const QUIZ_SEED_QUESTION_TEMPLATE = "Answer the following question: {question}";

/**
 * Seed message 3 (assistant): the graded outcome. `{verdictLabel}` is the student-facing
 * wording from `verdictLabel()` (correct / partly correct / wrong), `{feedback}` the
 * grader's markdown feedback. (Seed message 2 is the student's own answer verbatim, so
 * it has no template.)
 */
export const QUIZ_SEED_VERDICT_TEMPLATE = "Your answer is {verdictLabel}. {feedback}";

/** Renders seed message 1 for one question's (already trimmed) text. */
export function buildQuestionSeed(question: string): string {
  // Function form of `replace` so `$&` / `$'` in the content is not treated as
  // capture-group syntax.
  return QUIZ_SEED_QUESTION_TEMPLATE.replace("{question}", () => question);
}

/** Renders seed message 3 from the verdict + the grader's feedback. */
export function buildVerdictSeed(verdict: QuizVerdict, feedback: string): string {
  return QUIZ_SEED_VERDICT_TEMPLATE.replace("{verdictLabel}", () => verdictLabel(verdict))
    .replace("{feedback}", () => feedback)
    .trim();
}
