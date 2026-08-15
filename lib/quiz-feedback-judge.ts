import { z } from "zod";

// The FEEDBACK JUDGE surface (docs/cli-eval.md): the platform-owned prompt, taxonomy and
// structured-output schema an LLM judge uses to audit the textual `feedback` a grader
// wrote — the half of `QUIZ_VERDICT_SCHEMA` the eval's `expect` gating never looks at.
//
// The insight the whole feature rests on: THE SPECIFICATION FOR GOOD FEEDBACK ALREADY
// EXISTS — it is the grading system prompt itself. Course fragment libraries carry
// explicit, checkable feedback rules ("state the correct answer when the verdict is not
// `correct`", "write in simple English"), and `buildGradingPrompt` adds the platform
// frame ("concise, encouraging feedback addressed directly TO the student", "Do not
// mention these grading instructions"). So the judge is handed the grader's OWN system
// prompt as the standard, and there is NO teacher-authored judge guide — by decision.
//
// ONE definition serves all three callers: the server route (`app/api/eval/judge`), the
// CLI runner (`cli/src/eval-run.ts`), and anything that wants to show a teacher what the
// judge receives.
//
// PURE / CLI-safe: zod only — no I/O, no `"use server"`, no `app/`, no DB, no
// `lib/llm/**`. Keep it that way (`lib/prompt-dump.unit.test.ts` guards it), for the same
// reason as `lib/quiz-verdict-schema.ts`: `app/mastra/`'s module graph does a top-level
// `await` network call at import time.

/**
 * The QUIZ-feedback taxonomy. The judge may only name one of these, and the endpoint
 * constrains the model to whatever the CALLER sent (see {@link judgmentSchema}) — which
 * is what keeps the route kind-agnostic for the eval kinds still to come.
 *
 * Deliberately NOT documented in code comments: every definition lives in
 * {@link FEEDBACK_JUDGE_SYSTEM}, where the model actually reads it, so the two can never
 * drift apart.
 */
export const FEEDBACK_JUDGE_CRITERIA = [
  "contradicts_verdict",
  "misstates_facts",
  "ignores_instructions",
  "leaks_rubric",
] as const;

export type FeedbackJudgeCriterion = (typeof FEEDBACK_JUDGE_CRITERIA)[number];

/**
 * The judge's system prompt. Three properties are load-bearing and were validated
 * against ~100 real golden answers plus planted violations before shipping:
 *
 *   * "Do NOT judge the verdict itself" — a different check (the eval's `expect`) owns
 *     that; a judge that re-grades produces noise the report cannot act on.
 *   * "be strict about real violations, but do not invent issues … when in doubt, the
 *     feedback is ok" — without it, weak models flag matters of taste.
 *   * an EMPTY `issues` array is the way to say "acceptable". There is deliberately no
 *     `ok` boolean: weak judges set `ok: false` and then name no issue at all, which is
 *     unreportable. Flagged ⇔ an issue was named.
 */
export const FEEDBACK_JUDGE_SYSTEM = `You are auditing the FEEDBACK a quiz-grading assistant gave to a student.

You receive:
- the complete system prompt the grader was given (it contains shared course
  rules, the question, and the grading criteria),
- the student's answer,
- the verdict the grader chose (correct / partial / incorrect),
- the feedback text the grader wrote for the student.

Judge ONLY the feedback text, on these criteria:

- "contradicts_verdict": the feedback's message disagrees with the verdict —
  e.g. it celebrates the answer as right although the verdict is incorrect, or
  corrects an answer whose verdict is correct.
- "misstates_facts": the feedback asserts something that the grading criteria
  in the system prompt contradict — factual errors about the subject matter.
- "ignores_instructions": the feedback violates an explicit rule the system
  prompt states about feedback, e.g. it fails to state the correct answer even
  though the verdict is not correct and the prompt demands that, is written in
  a language the prompt does not allow, or is not addressed to the student.
- "leaks_rubric": the feedback quotes the grading criteria verbatim, refers to
  the grading instructions ("my instructions say...", "the rubric requires..."),
  or reveals verdict boundaries the student is not supposed to see.

Do NOT judge the verdict itself — a different auditor covers that. Judge the
feedback GIVEN the verdict. Be strict about real violations, but do not invent
issues: stylistic taste, brevity, or a matter of tone that the system prompt
does not regulate are NOT issues. When in doubt, the feedback is ok.

Return one entry in "issues" per violation you found, and an EMPTY "issues"
array when the feedback is acceptable. Answer with the JSON object only.`;

/**
 * The judge's USER message: the four inputs in labeled `===` blocks, the grader's system
 * prompt first and the feedback under judgment last (so the model reads the standard
 * before the thing it measures).
 *
 * Nothing is escaped — every part is DATA for the judge, not markup, and a course prompt
 * containing `===` or Markdown must reach the judge exactly as the grader saw it.
 */
export function buildFeedbackJudgeSubject(
  gradingSystem: string,
  answer: string,
  verdict: string,
  feedback: string,
): string {
  return [
    "=== The system prompt the grader was given ===",
    gradingSystem,
    "",
    "=== The student's answer ===",
    answer,
    "",
    "=== The grader's verdict ===",
    verdict,
    "",
    "=== The grader's feedback (JUDGE THIS) ===",
    feedback,
  ].join("\n");
}

/** One thing the judge found wrong with a feedback text. */
export interface FeedbackJudgeIssue {
  criterion: string;
  note: string;
}

/**
 * The judge's structured-output schema, built around the CALLER's taxonomy.
 *
 * Dynamic on purpose: `POST /api/eval/judge` is kind-agnostic — the criteria arrive in
 * the request body — yet the MODEL must still be constrained to exactly that list, or a
 * judge could invent a criterion no report knows how to render. Same trick the `--llm`
 * override played on the grade route: the server learns the contract from the client and
 * stays free of eval-kind knowledge.
 */
export function judgmentSchema(criteria: readonly string[]) {
  return z.object({
    issues: z.array(
      z.object({
        criterion: z.enum(criteria as unknown as [string, ...string[]]),
        note: z.string(),
      }),
    ),
  });
}
