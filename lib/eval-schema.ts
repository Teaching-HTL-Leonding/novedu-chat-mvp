import { z } from "zod";
import { QUIZ_VERDICT_ENUM, QUIZ_VERDICT_VALUES } from "@/lib/quiz-verdict-schema";

// The zod source of truth for the EVAL YAML format (`docs/cli-eval.md`): a file of
// GOLDEN ANSWERS for one quiz — teacher-written student answers, each with the verdict
// the grader is expected to produce. `novedu-cli eval` replays them against the real
// grading path so a rubric change can be measured instead of guessed.
//
// The verdict enum is DERIVED from the grader's own structured-output schema
// (`QUIZ_VERDICT_ENUM`, lib/quiz-verdict-schema.ts) — never a mirrored literal list, so
// the two can never drift apart.
//
// `lib/schema-gen` generates `activities/evals/eval-yaml.schema.json` from
// `EvalYamlSchema`, so every field carries its teacher prose inline as
// `.meta({ description })`.
//
// PURE / CLI-safe: zod only — no I/O, no `app/**`, no DB (see the purity guard in
// `lib/prompt-dump.unit.test.ts`).

/** The verdict an eval case may expect — the grader's own three literals. */
export type EvalVerdict = z.infer<typeof QUIZ_VERDICT_ENUM>;

/** The three verdicts in canonical order (best → worst); the sort key for expected sets. */
export const EVAL_VERDICTS: readonly EvalVerdict[] = QUIZ_VERDICT_VALUES;

/**
 * Eval ids share the flat namespace of report headers and `--out` files, so they stay
 * URL- and YAML-plain: an alphanumeric start, then alphanumerics, `.`, `-` or `_`.
 */
export const EVAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ID_LENGTH = 128;

const expectSchema = z.union([QUIZ_VERDICT_ENUM, z.array(QUIZ_VERDICT_ENUM).min(1)]).meta({
  description:
    'The verdict this answer must be graded with: one of "correct", "partial", "incorrect", or a non-empty list of acceptable verdicts (e.g. [correct, partial]) when more than one grading is defensible.',
});

/** One golden answer: the student text plus the verdict(s) the grader must produce. */
export const EvalAnswerSchema = z.strictObject({
  expect: expectSchema,
  answer: z.string().min(1).meta({
    description:
      "The student answer to grade, verbatim. Written as a YAML block scalar (|) for multi-line answers.",
  }),
});

/** All golden answers for ONE question of the target quiz. */
export const EvalQuestionSchema = z.strictObject({
  question: z.string().min(1).meta({
    description:
      'The question id in the target quiz. For a question imported through quiz_files this is the namespaced "<alias>/<id>" form.',
  }),
  answers: z.array(EvalAnswerSchema).min(1).meta({
    description: "The golden answers for this question — at least one.",
  }),
});

/** The whole eval file. */
export const EvalYamlSchema = z.strictObject({
  id: z.string().regex(EVAL_ID_PATTERN).max(MAX_ID_LENGTH).meta({
    description:
      "Stable identifier of this eval, shown in the run report. Letters, digits, dot, dash and underscore.",
  }),
  target: z.string().min(1).meta({
    description:
      "The quiz YAML this eval grades against — a path relative to THIS file, or an absolute http(s) URL.",
  }),
  questions: z.array(EvalQuestionSchema).min(1).meta({
    description: "The evaluated questions — at least one, each with its golden answers.",
  }),
});

export type EvalYaml = z.infer<typeof EvalYamlSchema>;
export type EvalQuestion = z.infer<typeof EvalQuestionSchema>;
export type EvalAnswer = z.infer<typeof EvalAnswerSchema>;

/**
 * The canonical expected-verdict SET of one golden answer: a single verdict or a list,
 * deduped and sorted into `EVAL_VERDICTS` order. Canonical because the confusion
 * matrix keys its rows by this set — `correct|partial` must be one row no matter which
 * order the author happened to write it in.
 */
export function normalizeExpect(expect: EvalAnswer["expect"]): EvalVerdict[] {
  const values = Array.isArray(expect) ? expect : [expect];
  const unique = [...new Set(values)];
  return unique.sort((a, b) => EVAL_VERDICTS.indexOf(a) - EVAL_VERDICTS.indexOf(b));
}

/** The confusion matrix's row key for an expected set (already canonical). */
export function expectedKey(expected: readonly EvalVerdict[]): string {
  return expected.join("|");
}
