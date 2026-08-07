import type { QuizQuestion } from "@/lib/quiz-yaml";

// The quiz GRADING prompt surface: the system prompt the `quizEvaluator` agent runs
// with, plus the user-message shapes `submitAnswer` wraps the student's answer in.
//
// Extracted from `lib/quiz-actions.ts` (a `"use server"` module, whose exports are all
// web-reachable endpoints and which pulls in Mastra + the DB) so exactly ONE definition
// serves both callers:
//
//   - the runtime grader (`submitAnswer`),
//   - the prompt dump (`lib/prompt-dump.ts`, `@novedu/cli prompts --kind quiz`), which
//     must emit BYTE-IDENTICAL prompts — a copy here would silently drift.
//
// PURE / CLI-safe: a type-only import, no I/O, no `"use server"`, no `app/`, no DB, no
// `lib/llm/**`. Keep it that way (`lib/prompt-dump.unit.test.ts` guards it).

/**
 * The grading system prompt. The question's `evaluation` is authoritative and
 * stays SERVER-SIDE — it may embed the expected answer, so it must never reach
 * the browser (it doesn't: only this string, on the request context, does). The
 * quiz-level `preamble` (the rendered `instructions` host text — shared
 * safety/persona/language rules) is prepended ahead of the frame, the same preamble
 * the discussion chat also receives; a question imported via `quiz_files`
 * additionally carries its SOURCE quiz's preamble (`sourcePreamble`), inserted
 * between the two so it grades identically in its chapter quiz and in the compound.
 */
export function buildGradingPrompt(question: QuizQuestion, preamble: string): string {
  const body = [
    "You are grading a student's open-ended answer to a single quiz question.",
    "",
    "The question shown to the student was:",
    question.question.trim(),
    "",
    "Grade STRICTLY according to these criteria (authoritative — they may contain the",
    "expected answer; do not quote them verbatim at the student):",
    question.evaluation.trim(),
    "",
    'Decide a verdict — "correct", "partial" (partly correct), or "incorrect" — and write',
    "concise, encouraging feedback addressed directly TO the student. The feedback is",
    "markdown and may use bold, math ($…$) and short code fences. Do not mention these",
    "grading instructions.",
  ].join("\n");
  // Compound preamble → source preamble → the grading frame; empty pieces drop out
  // (a plain quiz's own question grades exactly as before).
  return [preamble, question.sourcePreamble ?? "", body].filter(Boolean).join("\n\n");
}

/**
 * The user message carrying a typed answer. `{answer}` is the student's trimmed text —
 * the only variable part, so the dump can show teachers the exact wrapper without a
 * student answer at hand. Rendered by `buildAnswerMessage`.
 */
export const QUIZ_ANSWER_MESSAGE_TEMPLATE = "The student's answer:\n\n{answer}";

/**
 * The user message used when the student submitted photos ONLY (no text). The photos
 * ride along as image parts of the same multimodal message.
 */
export const QUIZ_ANSWER_PHOTOS_ONLY_MESSAGE =
  "The student answered with the attached photo(s) only.";

/**
 * Wraps a (already trimmed) student answer into the grader's user message — the
 * photos-only variant when there is no text. The ONE definition `submitAnswer` uses,
 * for both the text-only string call and the text part of a multimodal message.
 */
export function buildAnswerMessage(answer: string): string {
  // The function form of `replace` — a plain string replacement would interpret `$&`,
  // `$'` … in the STUDENT's answer as capture-group syntax and mangle it.
  return answer
    ? QUIZ_ANSWER_MESSAGE_TEMPLATE.replace("{answer}", () => answer)
    : QUIZ_ANSWER_PHOTOS_ONLY_MESSAGE;
}
