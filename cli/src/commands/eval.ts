import { globSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { type EvalCheckOk, loadAndCheckEval } from "@/lib/eval-validate";
import { LLM_PROVIDERS } from "@/lib/llm/provider";
import { failJson, performApiRequest } from "../api";
import {
  batchPassed,
  type EvalBatchFileInput,
  type EvalBatchIssue,
  type EvalRunLlm,
  type EvalUsage,
  type GradeFn,
  runEval,
  summarizeBatch,
} from "../eval-run";
import { cliFetcher } from "../file-fetcher";
import { formatEvalBatchReport, formatEvalReport } from "../format";
import { renderEvalMarkdownReport } from "../report-md";
import { cliVersion } from "../version";
import { toUrl } from "./validate";

// `novedu-cli eval <evalPathOrUrl...>` — replay a file of GOLDEN ANSWERS against the
// real quiz grader and report how the rubric performed (docs/cli-eval.md).
//
// The split is deliberate: the CLI assembles every grading prompt OFFLINE (through the
// app's own `dumpPrompts` seam, so unpushed local YAML works), and the server grades
// ONE answer per request on the exact production path. The fan-out, the retries, the
// majority vote and the whole report live here; the endpoint stays stateless.
//
// `eval` is a strict-mode reserved identifier, so every binding here is named
// `registerEval` / `runEvalCommand` / `evalFile` — never `eval`.

const CONCURRENCY_DEFAULT = 4;

interface EvalOptions {
  server?: string;
  concurrency?: string;
  repeats?: string;
  llmProvider?: string;
  llmModel?: string;
  json?: boolean;
  out?: string;
  report?: string;
}

/** Shell metacharacters that make a plain argument a PATTERN rather than a path. */
const GLOB_MAGIC = /[*?[\]{}]/;

/**
 * Turn the positional arguments into the list of sources to evaluate. A `file:` /
 * `http(s):` URL and a plain path pass through untouched (so a shell-expanded glob —
 * which arrives as plain paths — behaves identically); an argument carrying glob magic
 * is expanded relative to the cwd and sorted, which is what makes `"./**\/*.eval.yaml"`
 * and PowerShell/cmd work. A pattern that matches NOTHING is a hard failure: it is
 * almost certainly a typo, and silently evaluating zero files would exit 0.
 */
export function expandSources(
  args: readonly string[],
): { ok: true; sources: string[]; duplicates: string[] } | { ok: false; message: string } {
  const expanded: string[] = [];
  for (const arg of args) {
    if (/^(?:https?|file):/i.test(arg) || !GLOB_MAGIC.test(arg)) {
      expanded.push(arg);
      continue;
    }
    let matches: string[];
    try {
      matches = [...globSync(arg)];
    } catch (error) {
      return {
        ok: false,
        message: `Could not expand the pattern "${arg}": ${error instanceof Error ? error.message : error}`,
      };
    }
    if (matches.length === 0) {
      return { ok: false, message: `The pattern "${arg}" matched no files.` };
    }
    // Deterministic run order regardless of directory-read order.
    expanded.push(...matches.sort((a, b) => a.localeCompare(b)));
  }

  const sources: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const entry of expanded) {
    const url = toUrl(entry);
    if (seen.has(url)) {
      duplicates.push(url);
      continue;
    }
    seen.add(url);
    sources.push(url);
  }
  return { ok: true, sources, duplicates };
}

/** The `--llm-provider`/`--llm-model` pair: strictly both-or-nothing, provider checked. */
function parseOverride(
  options: EvalOptions,
): { ok: true; llm?: { provider: string; model: string } } | { ok: false; message: string } {
  const { llmProvider, llmModel } = options;
  if (llmProvider === undefined && llmModel === undefined) return { ok: true };
  if (llmProvider === undefined || llmModel === undefined) {
    return {
      ok: false,
      message: "Pass --llm-provider and --llm-model together, or neither.",
    };
  }
  if (!(LLM_PROVIDERS as readonly string[]).includes(llmProvider)) {
    return {
      ok: false,
      message: `Unknown --llm-provider "${llmProvider}": expected ${LLM_PROVIDERS.map((p) => `"${p}"`).join(" or ")}.`,
    };
  }
  return { ok: true, llm: { provider: llmProvider, model: llmModel } };
}

/**
 * The optional `usage: { input, cachedInput, output }` of a 200 response, defensively:
 * anything that is not three finite numbers is simply absent (an older server, or one
 * whose provider reports nothing, must never break a run).
 */
function parseUsage(value: unknown): EvalUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { input, cachedInput, output } = value as Record<string, unknown>;
  const counts = [input, cachedInput, output].map((count) =>
    typeof count === "number" && Number.isFinite(count) ? Math.max(0, count) : undefined,
  );
  if (counts.some((count) => count === undefined)) return undefined;
  const [inputCount = 0, cachedCount = 0, outputCount = 0] = counts as number[];
  return { input: inputCount, cachedInput: cachedCount, output: outputCount };
}

/**
 * The HTTP seam for ONE grading call, with the run's effective llm closed in — so the
 * runner itself never learns whether the pair came from the quiz or from `--llm-*`.
 * Classifies the failure for the retry policy: 5xx and true network failures are
 * retryable, auth failures abort the run, every other 4xx is terminal.
 */
function makeGradeFn(
  server: string | undefined,
  llm: { provider: string; model: string },
): GradeFn {
  return async ({ system, answer }) => {
    const response = await performApiRequest({
      server,
      path: "/api/eval/grade",
      method: "POST",
      body: { llm, system, answer },
      quiet: true,
    });
    if (response.ok) {
      const payload = response.payload as {
        result?: unknown;
        feedback?: unknown;
        usage?: unknown;
      } | null;
      const verdict = payload?.result;
      if (verdict === "correct" || verdict === "partial" || verdict === "incorrect") {
        const usage = parseUsage(payload?.usage);
        return {
          ok: true,
          verdict,
          feedback: typeof payload?.feedback === "string" ? payload.feedback : "",
          // Optional on the wire: a server that does not report tokens must change
          // nothing about the run.
          ...(usage ? { usage } : {}),
        };
      }
      // A 2xx whose body is not a verdict is almost never a grading problem — it is a
      // server that doesn't OFFER the endpoint (e.g. one predating the eval feature,
      // whose cookie gate answers with a sign-in page). Say so, instead of a
      // model-shaped message that sends the user debugging the wrong layer.
      return {
        ok: false,
        retryable: false,
        error: {
          message:
            "The server's response is not a grading verdict — it may not offer " +
            "/api/eval/grade at all (does it run a Novedu version with the eval " +
            "feature?). Check the target server, e.g. --server http://localhost:3000.",
        },
      };
    }
    return {
      ok: false,
      // No status ⇒ the request never reached the server (network) ⇒ worth retrying.
      retryable: response.status === undefined || response.status >= 500,
      ...(response.authFailed ? { auth: true as const } : {}),
      error: response.error,
    };
  };
}

/** stderr progress, suppressed off a TTY so CI logs stay readable. */
function progressWriter(
  prefix: string,
): ((p: { done: number; total: number }) => void) | undefined {
  if (!process.stderr.isTTY) return undefined;
  return ({ done, total }) => {
    process.stderr.write(`\r${prefix}${done}/${total}   `);
  };
}

/**
 * The command's core, exported for the unit tests. `seams` exists only so tests can
 * shrink the retry backoff — the CLI itself never passes it (PoC parity: 4 attempts,
 * 5 s linear).
 */
export async function runEvalCommand(
  pathsOrUrls: string[],
  options: EvalOptions,
  seams: { retry?: { attempts?: number; baseDelayMs?: number } } = {},
): Promise<void> {
  const override = parseOverride(options);
  if (!override.ok) {
    failJson({ message: override.message });
    return;
  }

  const expansion = expandSources(pathsOrUrls);
  if (!expansion.ok) {
    failJson({ message: expansion.message });
    return;
  }
  for (const duplicate of expansion.duplicates) {
    process.stderr.write(`Warning: ${duplicate} was given more than once — ignoring the copy.\n`);
  }

  const repeats = Math.max(1, Number.parseInt(options.repeats ?? "1", 10) || 1);
  const concurrency = Math.max(
    1,
    Number.parseInt(options.concurrency ?? String(CONCURRENCY_DEFAULT), 10) || CONCURRENCY_DEFAULT,
  );

  // PHASE 1 — check EVERY file before any grading call. An invalid file becomes a
  // file-level `invalid` entry and the run continues (per-entry isolation); only if
  // ALL files are invalid does the run end before touching the network.
  const checked = new Map<string, EvalCheckOk>();
  const files: EvalBatchFileInput[] = [];
  for (const source of expansion.sources) {
    const result = await loadAndCheckEval(source, cliFetcher, {
      allowedSchemes: ["http:", "https:", "file:"],
    });
    if (!result.ok) {
      files.push({ source, status: "invalid", errors: result.errors as EvalBatchIssue[] });
      continue;
    }
    checked.set(source, result);
    files.push({ source, status: "ok" });
  }

  // Not ONE usable file is a hard failure, not a report: JSON on stderr, exit 1, no
  // grading call and no `--out` file (the CLI's convention, same as `codes sync`).
  if (checked.size === 0) {
    failJson({
      message:
        files.length === 1 ? "The eval file is not usable." : "None of the eval files are usable.",
      files: files.map((file) => ({ source: file.source, errors: file.errors ?? [] })),
      errors: files.flatMap((file) => file.errors ?? []),
    });
    return;
  }

  {
    const totalCases = [...checked.values()].reduce((sum, file) => sum + file.caseCount, 0);
    // A teacher about to fire hundreds of LLM calls should see the number FIRST — and
    // it anchors the progress counter that follows.
    process.stderr.write(
      `${totalCases} case(s) × ${repeats} repeat(s) = ${totalCases * repeats} grading call(s)\n`,
    );
  }

  // PHASE 2 — files sequentially, cases concurrent WITHIN a file: the server sees
  // exactly the load of N separate invocations.
  let fileIndex = 0;
  for (const file of files) {
    fileIndex += 1;
    const check = checked.get(file.source);
    if (!check) continue;
    const quizLlm = { provider: check.quizDump.llm.provider, model: check.quizDump.llm.model };
    const effective = override.llm ?? quizLlm;
    const llm: EvalRunLlm = {
      ...effective,
      ...(override.llm ? { overrides: quizLlm } : {}),
    };
    const prefix = files.length > 1 ? `(${fileIndex}/${files.length}) ${check.evalFile.id}: ` : "";
    file.result = await runEval("quiz", check, {
      grade: makeGradeFn(options.server, effective),
      concurrency,
      repeats,
      llm,
      onProgress: progressWriter(prefix),
      ...(seams.retry ? { retry: seams.retry } : {}),
    });
    if (process.stderr.isTTY) process.stderr.write("\n");
  }

  const batch = summarizeBatch(files);

  // `--json` and `--out` ALWAYS carry the batch shape, single file or not, so scripts
  // never branch and a glob's match count can never change the contract.
  const payload = JSON.stringify(batch, null, 2);
  if (options.json) {
    console.log(payload);
  } else if (files.length === 1 && files[0]?.result) {
    console.log(formatEvalReport(files[0].result, files[0].source));
  } else {
    console.log(formatEvalBatchReport(batch));
  }

  if (options.out) {
    try {
      await writeFile(options.out, `${payload}\n`, "utf8");
    } catch (error) {
      failJson({
        message: `Could not write ${options.out}: ${error instanceof Error ? error.message : error}`,
      });
      return;
    }
  }

  // `--report` is an independent SIDE CHANNEL: it composes with `--json`/`--out` and
  // never touches stdout — the same file-writing error handling as `--out`.
  if (options.report) {
    try {
      await writeFile(
        options.report,
        renderEvalMarkdownReport(batch, {
          generatedAt: new Date(),
          cliVersion: cliVersion(),
          repeats,
          concurrency,
        }),
        "utf8",
      );
    } catch (error) {
      failJson({
        message: `Could not write ${options.report}: ${error instanceof Error ? error.message : error}`,
      });
      return;
    }
  }

  // The CI gate: every file valid AND not one failed or errored case.
  process.exitCode = batchPassed(batch) ? 0 : 1;
}

export function registerEval(program: Command): void {
  program
    .command("eval")
    .description(
      "Grade a file of golden answers against its quiz's real rubric and report the result",
    )
    .argument(
      "<evalPathOrUrl...>",
      "one or more eval YAML files (paths, http(s)/file URLs, or a quoted glob pattern)",
    )
    .option(
      "--server <url>",
      "Novedu server base URL (defaults to the NOVEDU_SERVER env var, then production)",
    )
    .option("--concurrency <n>", "grading calls in flight per file", String(CONCURRENCY_DEFAULT))
    .option("--repeats <n>", "grade every answer N times and take the majority verdict", "1")
    .option(
      "--llm-provider <provider>",
      'grade with this provider instead of the quiz\'s ("SCCH" or "Azure Foundry"; needs --llm-model)',
    )
    .option(
      "--llm-model <model>",
      "grade with this model instead of the quiz's (needs --llm-provider)",
    )
    .option("--json", "print the machine-readable batch report on stdout")
    .option("--out <file>", "additionally write the machine-readable batch report to a file")
    .option("--report <file>", "additionally write a readable Markdown report to a file")
    .addHelpText(
      "after",
      `
Examples:
  # Evaluate one quiz's golden answers
  $ novedu-cli eval ./0010-welcome-quiz.eval.yaml

  # A whole course part (quote the pattern so the CLI expands it, ** included)
  $ novedu-cli eval "./part-1/**/*.eval.yaml"

  # Measure grader stability: 3 runs per answer, majority verdict
  $ novedu-cli eval ./my-quiz.eval.yaml --repeats 3

  # How would this rubric perform on another model? (both flags, always together)
  $ novedu-cli eval ./my-quiz.eval.yaml --llm-provider "Azure Foundry" --llm-model gpt-5-mini

  # Machine-readable, for CI
  $ novedu-cli eval ./my-quiz.eval.yaml --json --out eval-report.json

  # A readable Markdown report (questions, golden answers, grader feedback, tokens)
  $ novedu-cli eval ./my-quiz.eval.yaml --report eval-report.md`,
    )
    .action(async (pathsOrUrls: string[], options: EvalOptions) => {
      await runEvalCommand(pathsOrUrls, options);
    });
}
