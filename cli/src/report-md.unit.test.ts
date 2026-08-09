// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { EvalBatchFileInput, EvalCaseResult, EvalRunResult } from "./eval-run";
import { summarizeBatch } from "./eval-run";
import { renderEvalMarkdownReport } from "./report-md";

// The Markdown report over a representative batch: a clean file, a file with a
// mismatch + an errored + an unstable case + skipped cases from an abort, and an
// invalid file. Asserts the overview table, that details exist ONLY for problems, and
// that teacher-authored text can never break the table or the document structure.

const META = {
  generatedAt: new Date("2026-08-08T14:32:09.000Z"),
  cliVersion: "0.19.0",
  repeats: 1,
  concurrency: 4,
};

function evalCase(overrides: Partial<EvalCaseResult> & Pick<EvalCaseResult, "questionId">) {
  return {
    answerIndex: 0,
    expected: ["correct"],
    answer: "a golden answer",
    status: "passed",
    unstable: false,
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
    totals: {
      cases: cases.length,
      passed: cases.filter((c) => c.status === "passed").length,
      failed: cases.filter((c) => c.status === "failed").length,
      errored: cases.filter((c) => c.status === "errored").length,
      skipped: cases.filter((c) => c.status === "skipped").length,
      unstable: cases.filter((c) => c.unstable).length,
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
    expect(md).toContain("| ✅ pass.eval.yaml | `demo-eval` | 1 | 1 | 0 | 0 | 0 | 0 | 0/0 |");
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
