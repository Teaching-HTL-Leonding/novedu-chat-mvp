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
  assembleFragmentPrompt,
  error,
  type Fetcher,
  type LoadOptions,
  loadYaml,
  type ValidationError,
  type ValidationWarning,
  validate,
} from "@/lib/prompt-fragments";
import type { LlmProvider } from "./llm/provider";
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
      /** The LLM provider serving `model` (`llm.provider`, default SCCH). */
      provider: LlmProvider;
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
 * Check an already-schema-validated quiz: unique question ids → metadata. Split from
 * `checkQuizValue` so `loadAndCheckQuiz` can reuse the single `validate` it already ran
 * (no second parse of the same document against the same schema).
 */
function checkQuizParsed(quiz: QuizYaml): QuizCheckResult {
  const errors = findDuplicateQuestionIds(quiz);
  if (errors.length > 0) return { ok: false, errors, warnings: [] };

  return {
    ok: true,
    quizId: quiz.id,
    model: quiz.llm.model,
    provider: quiz.llm.provider,
    questionCount: quiz.questions.length,
    anonymous: quiz.anonymous ?? DEFAULT_ANONYMOUS,
    title: quiz.title ?? null,
    warnings: [],
  };
}

/**
 * Validate an already-parsed quiz value: schema → unique question ids → metadata.
 * Pure (the parsed value is passed in); `loadAndCheckQuiz` wraps it with fetch +
 * YAML parse.
 */
export function checkQuizValue(parsed: unknown, url?: string): QuizCheckResult {
  const valid = validate<QuizYaml>(parsed, QuizYamlSchema, "QUIZ_SCHEMA_ERROR", url);
  if (!valid.ok) return { ok: false, errors: [valid.error], warnings: [] };
  return checkQuizParsed(valid.data);
}

/**
 * Validate a quiz FILE: scheme-gate + fetch + parse (shared `loadYaml`), the pure
 * `checkQuizValue`, then the document-level fragment block's authoring gate — fetch
 * every referenced library, run the THOROUGH whole-library check, consistency, and an
 * assembly dry-run (the strict-Handlebars backstop). The web app passes the default
 * http(s)-only schemes; the CLI adds `file:` so a local quiz YAML on disk validates too.
 */
export async function loadAndCheckQuiz(
  url: string,
  fetchImpl: Fetcher,
  opts: LoadOptions = {},
): Promise<QuizCheckResult> {
  const yaml = await loadYaml(url, fetchImpl, opts);
  if (!yaml.ok) return { ok: false, errors: [yaml.error], warnings: [] };

  // Validate the schema ONCE, then reuse the typed value for both the question-id check
  // and the fragment block below (no second parse of the same document).
  const valid = validate<QuizYaml>(yaml.value, QuizYamlSchema, "QUIZ_SCHEMA_ERROR", url);
  if (!valid.ok) return { ok: false, errors: [valid.error], warnings: [] };

  const checked = checkQuizParsed(valid.data);
  if (!checked.ok) return checked;

  // The fragment block's authoring gate: fetch + consistency + assembly dry-run
  // (authoring default: `validateLibraries: true`).
  const assembled = await assembleFragmentPrompt(
    { fragment_files: valid.data.fragment_files, fragments: valid.data.fragments },
    url,
    fetchImpl,
    { allowedSchemes: opts.allowedSchemes, validateLibraries: opts.validateLibraries ?? true },
  );
  const warnings = [...checked.warnings, ...assembled.warnings];
  if (!assembled.ok) return { ok: false, errors: assembled.errors, warnings };
  return { ...checked, warnings };
}
