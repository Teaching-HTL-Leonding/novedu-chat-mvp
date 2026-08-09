import type {
  EvalBatchFile,
  EvalBatchResult,
  EvalCaseResult,
  EvalRunLlm,
  EvalRunResult,
  EvalUsage,
} from "./eval-run";

// The Markdown report of an eval run (`novedu-cli eval --report <file.md>`): a PURE
// renderer over the same `EvalBatchResult` `--json` emits, written for a TEACHER rather
// than for a script — the overview first, then only what needs attention.
//
// ONE uniform layout for a single file and for a batch, exactly like the JSON shape: a
// reader (or a diff between two runs) never has to learn a second structure because a
// glob happened to match one file.
//
// Two deliberate rules:
//   * DETAILS ONLY FOR WHAT WENT WRONG — mismatched, errored and unstable cases,
//     skipped counts and invalid files. A clean pass has no per-case section; the JSON
//     carries every case for anyone who wants them.
//   * TEACHER-AUTHORED TEXT IS DATA — question texts, golden answers and grader
//     feedback are neutralized where Markdown structure would break (pipes and newlines
//     in table cells, list items), and otherwise quoted verbatim line by line so an
//     answer is never silently reformatted.
//
// Everything variable (the timestamp included) is injected, so the output is a pure
// function of its inputs and unit-testable byte for byte.

/** The run metadata the report stamps that the batch result itself does not carry. */
export interface EvalReportMeta {
  /** Injected rather than read from the clock — the renderer stays pure. */
  generatedAt: Date;
  /** The CLI that produced the run (`cliVersion()`). */
  cliVersion: string;
  repeats: number;
  concurrency: number;
}

/** `2026-08-08 14:32 UTC` — UTC always, so two reports are comparable across machines. */
function timestamp(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Thousands-separated, en-US so the report reads the same on every machine. */
function count(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * A teacher-authored string made safe for a TABLE CELL: newlines collapse to spaces
 * (a raw newline would end the row) and pipes are escaped (they would split it).
 */
function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** The same neutralization for a LIST ITEM, where only the newline is structural. */
function inline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A verbatim blockquote: every line prefixed, so the text keeps its own line breaks and
 * can never escape into the surrounding document structure.
 */
function quote(text: string): string {
  const lines = text.replace(/\s+$/, "").split(/\r?\n/);
  return lines.map((line) => (line ? `> ${line}` : ">")).join("\n");
}

/** `SCCH / gemma-4`, or `SCCH / gemma-4 → Azure Foundry / gpt-5-mini (override)`. */
function llmText(llm: EvalRunLlm): string {
  const effective = `${llm.provider} / ${llm.model}`;
  return llm.overrides
    ? `${llm.overrides.provider} / ${llm.overrides.model} → ${effective} (override)`
    : effective;
}

/** `15,420 / 12,300 / 2,810`, or an em dash when nothing was reported. */
function usageCell(usage: EvalUsage): string {
  if (usage.input === 0 && usage.cachedInput === 0 && usage.output === 0) return "—";
  return `${count(usage.input)} / ${count(usage.cachedInput)} / ${count(usage.output)}`;
}

/** The last path segment of a source URL — how a file is named throughout the report. */
function shortSource(source: string): string {
  try {
    const { pathname } = new URL(source);
    return decodeURIComponent(pathname.split("/").pop() || source);
  } catch {
    return source;
  }
}

/** `1/12 (8.3%)` — the false-correct rate, or `0/0` when nothing could be false-correct. */
function falseCorrectCell(result: EvalRunResult): string {
  const { count: hits, denominator, rate } = result.falseCorrect;
  return denominator === 0 ? `${hits}/0` : `${hits}/${denominator} (${(rate * 100).toFixed(1)}%)`;
}

const OVERVIEW_HEADER = [
  "File",
  "Eval",
  "Cases",
  "Passed",
  "Failed",
  "Errored",
  "Skipped",
  "Unstable",
  "False-correct",
  "Tokens (in / cached / out)",
];

/** `| a | b |` for one row of the overview table. */
function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/** The overview table: one row per file, plus a grand TOTAL row for a real batch. */
function overview(batch: EvalBatchResult): string[] {
  const lines = [
    row(OVERVIEW_HEADER),
    // Names left, numbers right — the shape a teacher scans down.
    row(["---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]),
  ];
  for (const file of batch.files) {
    const name = cell(shortSource(file.source));
    if (!file.result) {
      // An invalid file keeps its row (it is part of the run) but claims no numbers;
      // its validation errors are listed in the details section.
      lines.push(row([name, "**invalid**", "—", "—", "—", "—", "—", "—", "—", "—"]));
      continue;
    }
    const t = file.result.totals;
    lines.push(
      row([
        `${file.passed ? "✅" : "❌"} ${name}`,
        `\`${cell(file.result.id)}\``,
        count(t.cases),
        count(t.passed),
        count(t.failed),
        count(t.errored),
        count(t.skipped),
        count(t.unstable),
        falseCorrectCell(file.result),
        usageCell(t.usage),
      ]),
    );
  }
  if (batch.files.length > 1) {
    const g = batch.totals;
    lines.push(
      row([
        "**TOTAL**",
        g.invalid ? `${count(g.invalid)} invalid` : "",
        `**${count(g.cases)}**`,
        `**${count(g.passed)}**`,
        `**${count(g.failed)}**`,
        `**${count(g.errored)}**`,
        `**${count(g.skipped)}**`,
        `**${count(g.unstable)}**`,
        "",
        `**${usageCell(g.usage)}**`,
      ]),
    );
  }
  return lines;
}

/** The one-line error message an errored repeat row carries. */
function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return JSON.stringify(error ?? null);
}

/** `expected correct, got incorrect` — the heading's verdict half. */
function verdictSummary(evalCase: EvalCaseResult): string {
  const expected = evalCase.expected.join(" | ");
  const got = evalCase.status === "errored" ? "error" : (evalCase.verdict ?? "no verdict");
  return `expected ${expected}, got ${got}`;
}

/** Whether a case belongs in the details section at all (§ details only for problems). */
function needsDetail(evalCase: EvalCaseResult): boolean {
  return evalCase.status === "failed" || evalCase.status === "errored" || evalCase.unstable;
}

/**
 * One case's section: the question it belongs to, the golden answer, and what the
 * grader said — plus every repeat when they disagreed (the `--repeats` signal is
 * exactly what a teacher wants to read here, not a majority hidden behind one line).
 */
function caseSection(evalCase: EvalCaseResult, questionText: string | undefined): string[] {
  const lines: string[] = [];
  const unstable = evalCase.unstable ? " *(unstable)*" : "";
  lines.push(
    `### \`${evalCase.questionId}\` #${evalCase.answerIndex} — ${verdictSummary(evalCase)}${unstable}`,
  );
  lines.push("");

  if (questionText) {
    lines.push("**Question**");
    lines.push("");
    lines.push(quote(questionText));
    lines.push("");
  }

  lines.push("**Golden answer**");
  lines.push("");
  lines.push(quote(evalCase.answer));
  lines.push("");

  const graded = evalCase.repeats.filter((r) => r.got !== undefined);
  const disagreed = new Set(graded.map((r) => r.got)).size > 1;

  if (evalCase.repeats.length > 1 && (disagreed || graded.length !== evalCase.repeats.length)) {
    // Every observation, verbatim per repeat — an averaged single line would hide the
    // very nondeterminism the run was measuring.
    lines.push("**Repeats**");
    lines.push("");
    for (const repeat of evalCase.repeats) {
      const verdict = repeat.got ? `\`${repeat.got}\`` : "**error**";
      const detail = repeat.got
        ? inline(repeat.feedback ?? "")
        : inline(errorMessage(repeat.error));
      lines.push(`- #${repeat.repeatIndex + 1} — ${verdict}${detail ? ` — ${detail}` : ""}`);
    }
    lines.push("");
    return lines;
  }

  const feedback = graded.find((r) => r.feedback)?.feedback;
  if (feedback) {
    lines.push("**Grader feedback**");
    lines.push("");
    lines.push(quote(feedback));
    lines.push("");
  }
  const failure = evalCase.repeats.find((r) => r.error !== undefined);
  if (failure) {
    lines.push("**Error**");
    lines.push("");
    lines.push(quote(errorMessage(failure.error)));
    lines.push("");
  }
  return lines;
}

/** One file's details section, or `[]` when the file has nothing to report. */
function fileDetails(file: EvalBatchFile): string[] {
  const name = shortSource(file.source);

  if (!file.result) {
    const errors = file.errors ?? [];
    return [
      `## ${cell(name)} — invalid`,
      "",
      "This file was not graded; fix the problems below and run it again.",
      "",
      ...errors.map((issue) => `- \`${cell(issue.code)}\` — ${inline(issue.message)}`),
      "",
    ];
  }

  const result = file.result;
  const detailed = result.cases.filter(needsDetail);
  const skipped = result.totals.skipped;
  if (detailed.length === 0 && skipped === 0 && !result.aborted) return [];

  const questionText = new Map(result.questions.map((question) => [question.id, question.text]));
  const lines = [`## ${cell(name)} — \`${cell(result.id)}\``, ""];
  if (result.aborted) {
    lines.push("> [!WARNING]");
    lines.push(`> The run was aborted: ${inline(result.aborted.message)}`);
    lines.push("");
  }
  for (const evalCase of detailed) {
    lines.push(...caseSection(evalCase, questionText.get(evalCase.questionId)));
  }
  if (skipped > 0) {
    // One line, never one section per case: an aborted 252-case run must not print
    // hundreds of identical "never attempted" blocks.
    const reason = result.aborted ? ` (${inline(result.aborted.message)})` : "";
    lines.push(
      `**${count(skipped)} case(s) were never attempted**${reason} — the run is incomplete, so it cannot pass.`,
    );
    lines.push("");
  }
  return lines;
}

/**
 * Render the whole run as Markdown: verdict headline, the run's facts, the overview
 * table, then the details of everything that needs a teacher's attention.
 */
export function renderEvalMarkdownReport(batch: EvalBatchResult, meta: EvalReportMeta): string {
  const lines: string[] = [];
  lines.push(`# Eval report — ${batch.passed ? "✅ passed" : "❌ failed"}`);
  lines.push("");
  lines.push(`- **Generated** ${timestamp(meta.generatedAt)} · novedu-cli ${meta.cliVersion}`);

  const llms = [
    ...new Set(
      batch.files.filter((f) => f.result).map((f) => llmText((f.result as EvalRunResult).llm)),
    ),
  ];
  // Normally one line; a batch whose files declare different models keeps them all
  // rather than picking one and lying about the rest.
  for (const llm of llms) lines.push(`- **LLM** ${llm}`);

  lines.push(
    `- **Run** ${count(batch.totals.files)} file(s), ${count(batch.totals.cases)} case(s) × ` +
      `${count(meta.repeats)} repeat(s), concurrency ${count(meta.concurrency)}`,
  );
  const tokens = batch.totals.usage;
  if (tokens.input || tokens.cachedInput || tokens.output) {
    lines.push(
      `- **Tokens** ${count(tokens.input)} in (${count(tokens.cachedInput)} cached) / ` +
        `${count(tokens.output)} out — successful grading calls only, so a lower bound`,
    );
  }
  lines.push("");

  const aborted = batch.files.filter((file) => file.result?.aborted);
  if (aborted.length > 0) {
    lines.push("> [!WARNING]");
    lines.push(
      `> The run was ABORTED — ${count(batch.totals.skipped)} case(s) were never graded, ` +
        "so this report is incomplete.",
    );
    lines.push("");
  }

  lines.push("## Overview");
  lines.push("");
  lines.push(...overview(batch));
  lines.push("");

  // The per-file sections stay at `##`, siblings of the overview: a `## Details`
  // wrapper would make every file a child of it and push the cases to `####`, which
  // reads (and renders) worse than the flat file → case nesting.
  const details = batch.files.flatMap((file) => fileDetails(file));
  if (details.length === 0) {
    lines.push(
      "_Nothing else to report — every case matched its expected verdict. The `--json` report carries every case, including the passing ones._",
    );
    lines.push("");
  } else {
    lines.push(
      "_Below: only the mismatched, errored and unstable cases. Passing cases live in the `--json` report._",
    );
    lines.push("");
    lines.push(...details);
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
