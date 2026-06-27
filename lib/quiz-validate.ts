// The quiz AUTHORING validator — the quiz counterpart to `loadAndCheckFragmentFile`
// in `lib/tutors`. Strict schema (`QuizYamlSchema`) + a duplicate-question-id
// consistency pass, surfaced as structured `ValidationError[]` that BLOCK an
// invalid save. Wired into the validator seam (`lib/file-validators.ts`) and the
// `@novedu/cli validate --kind quiz` command.
//
// PURE / CLI-safe: imports only `lib/tutors` helpers (the shared scheme-gated YAML
// load, the Zod-validate wrapper, the error model) and the Zod schema — never
// `lib/quiz-fetch` (DB-backed) or any server-only module. The lenient runtime
// `parseQuiz` (`lib/quiz-yaml.ts`) is unchanged and separate.

import {
  error,
  type Fetcher,
  type LoadOptions,
  loadYaml,
  type ValidationError,
  type ValidationWarning,
  validate,
} from "@/lib/tutors";
import { type QuizYaml, QuizYamlSchema } from "./quiz-schema";

/**
 * The result of checking a quiz file. Mirrors `lib/tutors`' `FragmentCheckResult`,
 * but a quiz also carries the metadata the validator seam denormalizes onto the
 * code row: the privacy flag and a display title.
 */
export type QuizCheckResult =
  | {
      ok: true;
      quizId: string;
      model: string;
      questionCount: number;
      /** Privacy flag, default `true` (anonymous). */
      anonymous: boolean;
      title: string | null;
      warnings: ValidationWarning[];
    }
  | { ok: false; errors: ValidationError[]; warnings: ValidationWarning[] };

/** Quizzes default to anonymous — answers are recorded for stats but not attributed. */
const DEFAULT_ANONYMOUS = true;

/** Question ids declared on more than one question (the per-question stats key). */
function findDuplicateQuestionIds(quiz: QuizYaml): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  for (const question of quiz.questions) {
    if (seen.has(question.id)) {
      errors.push(
        error(
          "DUPLICATE_QUIZ_QUESTION_ID",
          `Question id "${question.id}" is declared more than once`,
          { questionId: question.id },
        ),
      );
      continue;
    }
    seen.add(question.id);
  }
  return errors;
}

/**
 * Validate an already-parsed quiz value: schema → unique question ids → metadata.
 * Pure (the parsed value is passed in); `loadAndCheckQuiz` wraps it with fetch +
 * YAML parse.
 */
export function checkQuizValue(parsed: unknown, url?: string): QuizCheckResult {
  const valid = validate<QuizYaml>(parsed, QuizYamlSchema, "QUIZ_SCHEMA_ERROR", url);
  if (!valid.ok) return { ok: false, errors: [valid.error], warnings: [] };
  const quiz = valid.data;

  const errors = findDuplicateQuestionIds(quiz);
  if (errors.length > 0) return { ok: false, errors, warnings: [] };

  return {
    ok: true,
    quizId: quiz.id,
    model: quiz.llm.model,
    questionCount: quiz.questions.length,
    anonymous: quiz.anonymous ?? DEFAULT_ANONYMOUS,
    title: quiz.title ?? null,
    warnings: [],
  };
}

/**
 * Validate a quiz FILE: scheme-gate + fetch + parse (shared `loadYaml`), then the
 * pure `checkQuizValue`. The web app passes the default http(s)-only schemes; the
 * CLI adds `file:` so a local quiz YAML on disk validates too.
 */
export async function loadAndCheckQuiz(
  url: string,
  fetchImpl: Fetcher,
  opts: LoadOptions = {},
): Promise<QuizCheckResult> {
  const yaml = await loadYaml(url, fetchImpl, opts);
  if (!yaml.ok) return { ok: false, errors: [yaml.error], warnings: [] };
  return checkQuizValue(yaml.value, url);
}
