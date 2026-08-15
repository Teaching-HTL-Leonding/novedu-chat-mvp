import type { EvalConversationTurn } from "@/lib/eval-schema";

// The TUTOR-EVAL JUDGE surface (docs/cli-eval.md): the platform-owned prompt, taxonomy
// and subject builder an LLM judge uses to audit ONE generated tutor response — the
// sibling of `lib/quiz-feedback-judge.ts`, and the reason `POST /api/eval/judge` needed
// zero server change to serve a second eval kind (both prompts AND the criteria travel
// in the request body; the schema factory stays `judgmentSchema` from the quiz module).
//
// The insight is the quiz judge's, one activity kind over: THE SPECIFICATION FOR A GOOD
// TUTOR RESPONSE ALREADY EXISTS — it is the tutor's own system prompt. A course tutor
// carries explicit, checkable rules ("never hand over a complete solution", "stay within
// this part's concepts", "answer in German"), so the judge is handed that prompt as the
// standard. The teacher's optional per-case `grading_instructions` are the ONE thing
// added on top, and only for the cases that state them.
//
// ONE definition serves both callers: the CLI runner (`cli/src/eval-run.ts`) and anything
// that wants to show a teacher what the judge receives.
//
// PURE / CLI-safe: types only — no I/O, no `"use server"`, no `app/`, no DB, no
// `lib/llm/**`. Keep it that way (`lib/prompt-dump.unit.test.ts` guards it), for the same
// reason as `lib/quiz-feedback-judge.ts`: `app/mastra/`'s module graph does a top-level
// `await` network call at import time.

/**
 * The TUTOR-response taxonomy. The judge may only name one of these, and the endpoint
 * constrains the model to whatever the CALLER sent (`judgmentSchema`) — which is what
 * keeps `/api/eval/judge` kind-agnostic.
 *
 * Deliberately NOT documented in code comments: every definition lives in
 * {@link TUTOR_JUDGE_SYSTEM}, where the model actually reads it, so the two can never
 * drift apart.
 */
export const TUTOR_JUDGE_CRITERIA = [
  "ignores_instructions",
  "fails_expectations",
  "misstates_facts",
  "leaks_prompt",
] as const;

export type TutorJudgeCriterion = (typeof TUTOR_JUDGE_CRITERIA)[number];

/** The criterion that only exists when the teacher stated expectations for the case. */
const EXPECTATIONS_CRITERION: TutorJudgeCriterion = "fails_expectations";

/**
 * The criteria ONE case's judge call may use. A case without `grading_instructions`
 * drops `fails_expectations` entirely — the per-request enum makes that free, and it
 * removes by construction the failure mode of a judge inventing expectations nobody
 * stated.
 */
export function tutorJudgeCriteria(hasGradingInstructions: boolean): TutorJudgeCriterion[] {
  return TUTOR_JUDGE_CRITERIA.filter(
    (criterion) => hasGradingInstructions || criterion !== EXPECTATIONS_CRITERION,
  );
}

/**
 * The judge's system prompt. The three guardrails measured on the quiz judge before
 * shipping carry over verbatim in spirit:
 *
 *   * "Do NOT judge pedagogical quality or style" — the tutor analogue of the quiz
 *     judge's "do not judge the verdict": a judge that rates teaching craft produces
 *     noise the report cannot act on. Compliance is the whole job.
 *   * "be strict about real violations, but do not invent issues … when in doubt, the
 *     response is ok" — without it, weak models flag matters of taste.
 *   * an EMPTY `issues` array is the way to say "acceptable". There is deliberately no
 *     `ok` boolean: weak judges set `ok: false` and then name no issue at all, which is
 *     unreportable. Flagged ⇔ an issue was named.
 */
export const TUTOR_JUDGE_SYSTEM = `You are auditing ONE response an AI TUTOR gave to a student.

You receive:
- the complete system prompt the tutor was given (it contains the persona, the
  course rules and the scope the tutor must stay inside),
- the conversation so far, turn by turn, ending with the student message the
  tutor had to answer,
- the response the tutor generated for that last student message,
- and, when the teacher wrote any, extra expectations for THIS case.

Judge ONLY the generated tutor response, on these criteria:

- "ignores_instructions": the response breaks an explicit rule of the tutor's
  own system prompt — e.g. it writes out the complete solution although the
  prompt forbids that, leaves the concepts the prompt limits it to, answers in
  a language the prompt does not allow, or ignores a stated formatting rule.
- "fails_expectations": the response violates the teacher's extra expectations
  for this case, when such expectations were given.
- "misstates_facts": the response asserts something that is factually wrong for
  the subject matter — bad code, a wrong term, an untrue claim.
- "leaks_prompt": the response quotes or reveals its own instructions, or talks
  about "my rules", "my prompt", "the instructions I was given".

Do NOT judge pedagogical quality, tone, length or style — a response you would
have written differently is NOT an issue. Judge COMPLIANCE with the system
prompt and with the stated expectations, nothing else. Be strict about real
violations, but do not invent issues. When in doubt, the response is ok.

Return one entry in "issues" per violation you found, and an EMPTY "issues"
array when the response is acceptable. Answer with the JSON object only.`;

/** `student:` / `tutor:` — the teacher-facing role labels, also used in the subject. */
function turnLabel(turn: EvalConversationTurn): string {
  return "student" in turn ? `student: ${turn.student}` : `tutor: ${turn.tutor}`;
}

/**
 * The judge's USER message: the inputs in labeled `===` blocks — the tutor's system
 * prompt (the standard), the scripted conversation, the response under judgment, and
 * the teacher's expectations when the case states any.
 *
 * Nothing is escaped — every part is DATA for the judge, not markup, and a course prompt
 * containing `===` or Markdown must reach the judge exactly as the tutor saw it.
 */
export function buildTutorJudgeSubject(
  tutorSystem: string,
  conversation: readonly EvalConversationTurn[],
  response: string,
  gradingInstructions?: string,
): string {
  const blocks = [
    "=== The system prompt the tutor was given ===",
    tutorSystem,
    "",
    "=== The conversation so far (the last turn is what the tutor answered) ===",
    conversation.map(turnLabel).join("\n\n"),
    "",
    "=== The tutor's generated response (JUDGE THIS) ===",
    response,
  ];
  // Absent entirely when the teacher stated none — together with the dropped
  // `fails_expectations` criterion, that leaves the judge nothing to invent from.
  if (gradingInstructions) {
    blocks.push("", "=== The teacher's expectations for this case ===", gradingInstructions);
  }
  return blocks.join("\n");
}
