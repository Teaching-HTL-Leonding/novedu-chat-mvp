// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { EvalBatchFileInput, EvalCaseResult, EvalRunResult } from "./eval-run";
import { summarizeBatch } from "./eval-run";
import { renderEvalMarkdownReport } from "./report-md";

// The Markdown report over a representative batch: a clean file, a file with a
// mismatch + an errored + an unstable case + skipped cases from an abort, and an
// invalid file. Asserts the overview table, that details exist ONLY for problems, and
// that teacher-authored text can never break the table or the document structure.
//
// Plus the FEEDBACK JUDGE's own surface: the Flagged column, the "Flagged feedback"
// section (whose cases usually PASSED — it reports on wording, not verdicts), the judge
// pair in the header, and the degraded-judging warning.

const META = {
  generatedAt: new Date("2026-08-08T14:32:09.000Z"),
  cliVersion: "0.19.0",
  repeats: 1,
  concurrency: 4,
};

/** The recommended pairing: a strong judge over the quiz's own grader. */
const JUDGE_PAIR = { provider: "Azure Foundry", model: "gpt-5.6-terra" };

function evalCase(overrides: Partial<EvalCaseResult> & Pick<EvalCaseResult, "questionId">) {
  return {
    answerIndex: 0,
    expected: ["correct"],
    answer: "a golden answer",
    status: "passed",
    unstable: false,
    feedbackFlagged: false,
    repeats: [{ repeatIndex: 0, got: "correct", feedback: "well done" }],
    ...overrides,
  } as EvalCaseResult;
}

function runResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  const cases = overrides.cases ?? [evalCase({ questionId: "q1" })];
  return {
    id: "demo-eval",
    target: "file:///quiz.yaml",
    llm: { provider: "SCCH", model: "gemma-4" },
    judging: "off",
    totals: {
      cases: cases.length,
      passed: cases.filter((c) => c.status === "passed").length,
      failed: cases.filter((c) => c.status === "failed").length,
      errored: cases.filter((c) => c.status === "errored").length,
      skipped: cases.filter((c) => c.status === "skipped").length,
      unstable: cases.filter((c) => c.unstable).length,
      feedbackFlagged: cases.filter((c) => c.feedbackFlagged).length,
      judgeErrored: cases.reduce(
        (sum, c) => sum + c.repeats.filter((row) => row.judgeError !== undefined).length,
        0,
      ),
      repeats: 1,
      calls: cases.length,
      usage: { input: 15_420, cachedInput: 12_300, output: 2810 },
    },
    mismatches: cases.filter((c) => c.status === "failed" || c.status === "errored"),
    cases,
    questions: [{ id: "q1", text: "What is **2 + 2**?" }],
    confusion: [],
    falseCorrect: { count: 0, denominator: 0, rate: 0 },
    ...overrides,
  } as EvalRunResult;
}

function render(files: EvalBatchFileInput[], meta = META): string {
  return renderEvalMarkdownReport(summarizeBatch(files), meta);
}

describe("renderEvalMarkdownReport — a clean run", () => {
  it("leads with the pass verdict, the run's facts and the overview table", () => {
    const md = render([{ source: "file:///a/pass.eval.yaml", status: "ok", result: runResult() }]);

    expect(md).toContain("# Eval report — ✅ passed");
    expect(md).toContain("2026-08-08 14:32 UTC · novedu-cli 0.19.0");
    expect(md).toContain("- **LLM** SCCH / gemma-4");
    // Judging off ⇒ an em dash in the Flagged column: "never judged" is not "found clean".
    expect(md).toContain("| ✅ pass.eval.yaml | `demo-eval` | 1 | 1 | 0 | 0 | 0 | 0 | — | 0/0 |");
    expect(md).toContain("15,420 / 12,300 / 2,810");
    expect(md).toContain("15,420 in (12,300 cached) / 2,810 out");
    // A single file needs no grand-total row.
    expect(md).not.toContain("**TOTAL**");
  });

  it("prints NO per-case details for passing cases", () => {
    const md = render([{ source: "file:///a/pass.eval.yaml", status: "ok", result: runResult() }]);

    expect(md).toContain("Nothing else to report");
    expect(md).not.toContain("### `q1`");
    expect(md).not.toContain("a golden answer");
  });

  it("renders the LLM override with an arrow", () => {
    const md = render([
      {
        source: "file:///a/pass.eval.yaml",
        status: "ok",
        result: runResult({
          llm: {
            provider: "Azure Foundry",
            model: "gpt-5-mini",
            overrides: { provider: "SCCH", model: "gemma-4" },
          },
        }),
      },
    ]);

    expect(md).toContain("- **LLM** SCCH / gemma-4 → Azure Foundry / gpt-5-mini (override)");
  });
});

describe("renderEvalMarkdownReport — a batch that went wrong", () => {
  const failed = evalCase({
    questionId: "q1",
    answerIndex: 1,
    expected: ["incorrect"],
    answer: "the wrong | answer\nsecond line",
    status: "failed",
    verdict: "correct",
    repeats: [{ repeatIndex: 0, got: "correct", feedback: "Nicely put." }],
  });
  const errored = evalCase({
    questionId: "q1",
    answerIndex: 2,
    status: "errored",
    repeats: [{ repeatIndex: 0, error: { message: "504 Gateway timeout" } }],
  });
  const unstable = evalCase({
    questionId: "q1",
    answerIndex: 3,
    status: "passed",
    verdict: "correct",
    unstable: true,
    repeats: [
      { repeatIndex: 0, got: "correct", feedback: "Right." },
      { repeatIndex: 1, got: "partial", feedback: "Half right." },
      { repeatIndex: 2, got: "correct", feedback: "Right again." },
    ],
  });
  const skipped = evalCase({
    questionId: "q1",
    answerIndex: 4,
    status: "skipped",
    repeats: [],
  });

  const batch = (): EvalBatchFileInput[] => [
    { source: "file:///a/pass.eval.yaml", status: "ok", result: runResult() },
    {
      source: "file:///a/broken-run.eval.yaml",
      status: "ok",
      result: runResult({
        id: "broken-run",
        cases: [failed, errored, unstable, skipped],
        aborted: {
          reason: "circuit-breaker",
          message: "3 cases failed in a row — the run was aborted.",
        },
      }),
    },
    {
      source: "file:///a/invalid.eval.yaml",
      status: "invalid",
      errors: [{ code: "EVAL_SCHEMA", message: "questions.0.answers: expected an array" }],
    },
  ];

  it("fails the verdict, marks each file and totals the batch", () => {
    const md = render(batch(), { ...META, repeats: 3 });

    expect(md).toContain("# Eval report — ❌ failed");
    expect(md).toContain("| ✅ pass.eval.yaml |");
    expect(md).toContain("| ❌ broken-run.eval.yaml |");
    expect(md).toContain("| invalid.eval.yaml | **invalid** | — |");
    expect(md).toContain("**TOTAL**");
    expect(md).toContain("The run was ABORTED");
  });

  it("details ONLY the mismatched, errored and unstable cases", () => {
    const md = render(batch(), { ...META, repeats: 3 });

    expect(md).toContain("### `q1` #1 — expected incorrect, got correct");
    expect(md).toContain("### `q1` #2 — expected correct, got error");
    expect(md).toContain("### `q1` #3 — expected correct, got correct *(unstable)*");
    // The passing case of the other file is still absent.
    expect(md).not.toContain("### `q1` #0");
    // Question text, golden answer and feedback, each quoted verbatim.
    expect(md).toContain("> What is **2 + 2**?");
    expect(md).toContain("> second line");
    expect(md).toContain("> Nicely put.");
    expect(md).toContain("> 504 Gateway timeout");
    // Repeats that disagreed are listed one by one.
    expect(md).toContain("- #2 — `partial` — Half right.");
    // Skipped cases get ONE summary line, never a section each.
    expect(md).toContain("**1 case(s) were never attempted**");
    expect(md).not.toContain("### `q1` #4");
  });

  it("lists an invalid file's validation errors instead of grading it", () => {
    const md = render(batch());

    expect(md).toContain("## invalid.eval.yaml — invalid");
    expect(md).toContain("- `EVAL_SCHEMA` — questions.0.answers: expected an array");
  });

  it("escapes pipes and newlines so a teacher's text cannot break a table row", () => {
    const md = render([
      {
        source: "file:///a/pipe|name.eval.yaml",
        status: "ok",
        result: runResult({ id: "pipes | and\nnewlines" }),
      },
    ]);

    const tableRow = md.split("\n").find((line) => line.includes("pipe")) ?? "";
    expect(tableRow).toContain("pipe\\|name.eval.yaml");
    expect(tableRow).toContain("pipes \\| and newlines");
    // Still exactly one row (a raw newline would have split it).
    expect(tableRow.startsWith("|")).toBe(true);
    expect(tableRow.endsWith("|")).toBe(true);
  });
});

describe("renderEvalMarkdownReport — flagged feedback", () => {
  const flagged = evalCase({
    questionId: "q1",
    answerIndex: 2,
    status: "passed",
    verdict: "incorrect",
    expected: ["incorrect"],
    answer: "not quite right",
    feedbackFlagged: true,
    repeats: [
      { repeatIndex: 0, got: "correct", feedback: "Spot on!", judge: { issues: [] } },
      {
        repeatIndex: 1,
        got: "incorrect",
        feedback: "Nice try, think about it a bit more!",
        judge: {
          issues: [{ criterion: "ignores_instructions", note: "never states\nthe correct answer" }],
        },
      },
    ],
  });

  const judged = (overrides = {}) =>
    runResult({
      judging: "on",
      llm: { provider: "SCCH", model: "gemma-4", judge: { ...JUDGE_PAIR, overridden: true } },
      cases: [evalCase({ questionId: "q1" }), flagged],
      ...overrides,
    });

  it("counts flags in the overview and details them in their OWN section", () => {
    const md = render([{ source: "file:///a/pass.eval.yaml", status: "ok", result: judged() }]);

    // Green run — flagged feedback reports, it never gates.
    expect(md).toContain("# Eval report — ✅ passed");
    expect(md).toContain("| ✅ pass.eval.yaml | `demo-eval` | 2 | 2 | 0 | 0 | 0 | 0 | 1 | 0/0 |");
    expect(md).toContain("### Flagged feedback");
    expect(md).toContain("#### `q1` #2");
    // The judged repeat's OWN verdict, its feedback verbatim, then the issues.
    expect(md).toContain("**Repeat #2 — `incorrect`**");
    expect(md).toContain("> Nice try, think about it a bit more!");
    expect(md).toContain("- `ignores_instructions` — never states the correct answer");
    // The clean repeat of the same case contributes nothing.
    expect(md).not.toContain("> Spot on!");
  });

  it("names the judge pair only when it DIFFERS from the grading pair", () => {
    const differing = render([
      { source: "file:///a/pass.eval.yaml", status: "ok", result: judged() },
    ]);
    expect(differing).toContain("- **Feedback judge** Azure Foundry / gpt-5.6-terra (override)");

    const same = render([
      {
        source: "file:///a/pass.eval.yaml",
        status: "ok",
        result: runResult({
          judging: "on",
          llm: {
            provider: "SCCH",
            model: "gemma-4",
            judge: { provider: "SCCH", model: "gemma-4", overridden: false },
          },
        }),
      },
    ]);
    // Repeating the grading pair would be noise.
    expect(same).not.toContain("**Feedback judge**");
  });

  it("warns prominently when judging DEGRADED, naming where it stopped", () => {
    const md = render([
      { source: "file:///a/pass.eval.yaml", status: "ok", result: runResult() },
      {
        source: "file:///a/judgeless.eval.yaml",
        status: "ok",
        result: judged({ judging: "degraded" }),
      },
    ]);

    expect(md).toContain("> [!WARNING]");
    expect(md).toContain("Feedback judging STOPPED during `judgeless.eval.yaml`");
    // Grading was fine, so the run still passes — the warning must not read as a failure.
    expect(md).toContain("# Eval report — ✅ passed");
    expect(md).toContain("Grading was unaffected.");
  });

  it("shows an em dash for a file that judged NOTHING, whatever the reason", () => {
    // One rule for the Flagged column: a count means "checked", an em dash means "not
    // checked". A file that ran entirely after the breaker degraded the run has judged
    // nothing, exactly like a file from a --no-judge-feedback run.
    const md = render([
      {
        source: "file:///a/after-degrade.eval.yaml",
        status: "ok",
        result: runResult({
          judging: "degraded",
          cases: [
            evalCase({
              questionId: "q1",
              repeats: [{ repeatIndex: 0, got: "correct", feedback: "ok", judge: null }],
            }),
          ],
        }),
      },
    ]);

    expect(md).toContain(
      "| ✅ after-degrade.eval.yaml | `demo-eval` | 1 | 1 | 0 | 0 | 0 | 0 | — |",
    );
  });

  it("keeps the real count on a degraded file that judged some repeats first", () => {
    const md = render([
      {
        source: "file:///a/partly.eval.yaml",
        status: "ok",
        result: judged({ judging: "degraded" }),
      },
    ]);

    // `judged()` carries one flagged case with real judgments, so this file WAS checked.
    expect(md).toContain("| ✅ partly.eval.yaml | `demo-eval` | 2 | 2 | 0 | 0 | 0 | 0 | 1 |");
  });

  it("prints no Flagged-feedback section when nothing was flagged", () => {
    const md = render([
      {
        source: "file:///a/pass.eval.yaml",
        status: "ok",
        result: runResult({
          judging: "on",
          // A judged run always stamps `judge` on its repeats; an empty issue list is how
          // the judge says "this feedback is fine".
          cases: [
            evalCase({
              questionId: "q1",
              repeats: [
                { repeatIndex: 0, got: "correct", feedback: "well done", judge: { issues: [] } },
              ],
            }),
          ],
        }),
      },
    ]);

    expect(md).not.toContain("Flagged feedback");
    expect(md).toContain("| 0 | 0/0 |"); // a real 0, not an em dash: this file WAS judged
  });
});

describe("renderEvalMarkdownReport — tokens", () => {
  it("omits the token line and shows an em dash when nothing was reported", () => {
    const md = render([
      {
        source: "file:///a/pass.eval.yaml",
        status: "ok",
        result: runResult({
          totals: { ...runResult().totals, usage: { input: 0, cachedInput: 0, output: 0 } },
        }),
      },
    ]);

    expect(md).not.toContain("- **Tokens**");
    expect(md).toContain("| —");
  });
});
