import { type EvalYaml, EvalYamlSchema } from "@/lib/eval-schema";
import { dumpPrompts, type QuizPromptDump } from "@/lib/prompt-dump";
import {
  error,
  type Fetcher,
  type LoadOptions,
  loadYaml,
  type ValidationError,
  type ValidationWarning,
} from "@/lib/prompt-fragments";
import { loadQuizFrom } from "@/lib/quiz-resolve";
import { loadAndCheckQuiz } from "@/lib/quiz-validate";

// The eval-file check: read + parse + schema-validate an eval YAML, resolve its
// `target` quiz, load that quiz's grading prompts, and cross-check every referenced
// question id. ONE function serves both consumers:
//
//   - `novedu-cli validate --kind eval` (offline authoring gate), which additionally
//     asks for `strictTarget` — the SAME strict quiz check `validate --kind quiz` runs.
//     Without it the lenient runtime load below would quietly assert LESS about the
//     quiz than `--kind quiz` does, which would break the validate contract.
//   - `novedu-cli eval` (the run), which deliberately keeps ONLY the lenient runtime
//     path: what the grader really receives is the whole point there.
//
// The grading prompts come from `dumpPrompts("quiz", …)` — the app's own prompt seam
// (`lib/prompt-dump.ts`), never a re-implementation — so an eval grades with
// byte-identical production prompts.
//
// PURE / CLI-safe (`lib/prompt-dump.unit.test.ts` grep-guards it): no `"use server"`,
// no `app/**`, no DB, no `lib/llm/model.ts`.

export interface EvalCheckOptions extends LoadOptions {
  /**
   * Also run the STRICT authoring check (`loadAndCheckQuiz`) on the resolved target —
   * what `validate --kind eval` needs so it asserts exactly as much about the quiz as
   * `validate --kind quiz` does. The `eval` command leaves it off (runtime parity).
   */
  strictTarget?: boolean;
}

/** A successfully checked eval: the parsed file, its resolved target, and the target's prompts. */
export interface EvalCheckOk {
  ok: true;
  /** The parsed eval document. (Named `evalFile`: `eval` is a reserved identifier.) */
  evalFile: EvalYaml;
  /** The `target` resolved against the eval file's own URL. */
  targetUrl: string;
  /** The target quiz's prompt dump — where each case's grading `system` prompt comes from. */
  quizDump: QuizPromptDump;
  /**
   * The RESOLVED quiz's questions as the student sees them — id + the question text
   * (Markdown). Reporting only: the Markdown report (`novedu-cli eval --report`) needs
   * to print the question a mismatched answer belongs to, and the prompt dump carries
   * only the id + the assembled grading prompt. Never gates anything, so a quiz whose
   * text could not be re-read simply yields an empty list.
   */
  quizQuestions: { id: string; text: string }[];
  /** How many golden answers the file declares (questions × answers). */
  caseCount: number;
  warnings: ValidationWarning[];
}

export type EvalCheckResult =
  | EvalCheckOk
  | { ok: false; errors: ValidationError[]; warnings: ValidationWarning[] };

function fail(errors: ValidationError[], warnings: ValidationWarning[] = []): EvalCheckResult {
  return { ok: false, errors, warnings };
}

/** Zod issues as one error each, the dotted path leading the message. */
function schemaErrors(issues: readonly { path: PropertyKey[]; message: string }[], url: string) {
  return issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");
    return error("EVAL_SCHEMA", path ? `${path}: ${issue.message}` : issue.message, { url });
  });
}

/**
 * Check ONE eval file end to end. `fetcher` is the caller's network seam and
 * `allowedSchemes` the usual SSRF gate (the CLI adds `file:` so an on-disk eval
 * resolves the quiz sitting next to it).
 */
export async function loadAndCheckEval(
  url: string,
  fetchImpl: Fetcher,
  opts: EvalCheckOptions = {},
): Promise<EvalCheckResult> {
  const allowedSchemes = opts.allowedSchemes;

  // 1. Read + YAML-parse (shared scheme gate), remapped onto the eval's own codes so a
  // report never mixes eval problems with quiz problems.
  const yaml = await loadYaml(url, fetchImpl, { allowedSchemes });
  if (!yaml.ok) {
    const code = yaml.error.code === "YAML_PARSE_ERROR" ? "EVAL_PARSE" : "EVAL_READ";
    return fail([error(code, yaml.error.message, { url })]);
  }

  // 2. Schema — strict objects, so a misspelled key is an error, not a silent no-op.
  const parsed = EvalYamlSchema.safeParse(yaml.value);
  if (!parsed.success) return fail(schemaErrors(parsed.error.issues, url));
  const evalFile = parsed.data;

  // 3. Resolve `target` against the EVAL file's own URL, then gate its scheme.
  let targetUrl: string;
  try {
    targetUrl = new URL(evalFile.target, url).href;
  } catch {
    return fail([
      error("EVAL_TARGET_ERROR", `The target "${evalFile.target}" is not a usable URL.`, { url }),
    ]);
  }
  if (allowedSchemes !== undefined) {
    let scheme = "";
    try {
      scheme = new URL(targetUrl).protocol;
    } catch {
      scheme = "";
    }
    if (!allowedSchemes.includes(scheme)) {
      return fail([
        error("EVAL_TARGET_ERROR", `The target URL is not allowed: ${targetUrl}`, {
          url: targetUrl,
        }),
      ]);
    }
  }

  const warnings: ValidationWarning[] = [];

  // 4. Authoring gate on the target (opt-in): the identical strict check
  // `validate --kind quiz` runs, so `validate --kind eval` never asserts less.
  if (opts.strictTarget) {
    const strict = await loadAndCheckQuiz(targetUrl, fetchImpl, {
      allowedSchemes,
      validateLibraries: opts.validateLibraries ?? true,
    });
    warnings.push(...strict.warnings);
    if (!strict.ok) return fail(strict.errors, warnings);
  }

  // 5. The RUNTIME load — the grading prompts exactly as production builds them.
  const dumped = await dumpPrompts("quiz", targetUrl, fetchImpl, { allowedSchemes });
  if (!dumped.ok) {
    return fail(
      dumped.errors.map((e) =>
        error("EVAL_TARGET_ERROR", `The target quiz could not be loaded: ${e.message}`, {
          url: targetUrl,
        }),
      ),
      warnings,
    );
  }
  const quizDump = dumped.dump;
  if (quizDump.kind !== "quiz") {
    return fail(
      [error("EVAL_TARGET_ERROR", "The target is not a quiz.", { url: targetUrl })],
      warnings,
    );
  }

  // 6. Cross-check every referenced question id against the RESOLVED pool (so an id
  // imported through `quiz_files` must be spelled with its `"<alias>/<id>"` namespace).
  const known = new Set(quizDump.grading.questions.map((question) => question.id));
  const unknown = evalFile.questions
    .filter((question) => !known.has(question.question))
    .map((question) =>
      error("EVAL_UNKNOWN_QUESTION", `The target quiz has no question "${question.question}".`, {
        questionId: question.question,
        url: targetUrl,
      }),
    );
  if (unknown.length > 0) return fail(unknown, warnings);

  // 7. The question TEXTS, for the Markdown report only. The prompt dump deliberately
  // carries the assembled grading prompts rather than the source document, so this
  // re-reads the resolved quiz through the SAME runtime loader `dumpPrompts` uses (the
  // `strictTarget` branch above already loads the target twice; a report string is not
  // worth widening the dump contract for). Purely additive: a failure here leaves the
  // list empty and the check itself unaffected.
  const resolved = await loadQuizFrom(targetUrl, fetchImpl, { allowedSchemes });
  const quizQuestions = resolved.ok
    ? resolved.quiz.questions.map((question) => ({ id: question.id, text: question.question }))
    : [];

  return {
    ok: true,
    evalFile,
    targetUrl,
    quizDump,
    quizQuestions,
    caseCount: evalFile.questions.reduce((sum, question) => sum + question.answers.length, 0),
    warnings,
  };
}
