import {
  type BuildResult,
  type FragmentCheckResult,
  formatZodIssues,
  type ValidationError,
  type ValidationWarning,
} from "@/lib/tutors";

// Pure presentation: turn a `BuildResult` into a human-readable terminal report.
// No validation logic lives here — it only renders the structured errors/warnings
// the core already produced.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => paint("32", s);
const red = (s: string) => paint("31", s);
const yellow = (s: string) => paint("33", s);
const dim = (s: string) => paint("2", s);

/** Append the context fields an error/warning carries, when present. */
function context(item: ValidationError | ValidationWarning): string {
  const parts: string[] = [];
  if (item.fileAlias) parts.push(`file=${item.fileAlias}`);
  if (item.fragmentId) parts.push(`fragment=${item.fragmentId}`);
  if (item.variable) parts.push(`variable=${item.variable}`);
  if ("url" in item && item.url) parts.push(`url=${item.url}`);
  if ("expectedType" in item && item.expectedType) {
    parts.push(`expected=${item.expectedType}`);
  }
  if ("actualType" in item && item.actualType) parts.push(`actual=${item.actualType}`);
  return parts.length ? dim(` (${parts.join(", ")})`) : "";
}

function renderWarnings(warnings: ValidationWarning[]): string[] {
  return warnings.map((w) => `  ${yellow("⚠")} ${yellow(w.code)} ${w.message}${context(w)}`);
}

/**
 * Render each error as a line, with any flattened Zod schema-issue detail
 * indented beneath it — so a generic "Document does not match the expected
 * structure" is followed by the actual field paths (e.g. `Unrecognized key:
 * "nae"`), matching what the web UI shows.
 */
function renderErrors(errors: ValidationError[]): string[] {
  const lines: string[] = [];
  for (const e of errors) {
    lines.push(`  ${red("✗")} ${red(e.code)} ${e.message}${context(e)}`);
    if (e.zodIssues) {
      for (const issue of formatZodIssues(e.zodIssues)) lines.push(`      ${dim(issue)}`);
    }
  }
  return lines;
}

export function formatResult(result: BuildResult, source: string): string {
  const lines: string[] = [];

  if (result.ok) {
    lines.push(green(`✔ Valid tutor`) + dim(` — ${source}`));
    lines.push(`  model: ${result.model}`);
    lines.push(`  system prompt: ${result.prompt.length} chars`);
    lines.push(
      `  imageInput: ${result.imageInput}   anonymous: ${result.anonymous}` +
        (result.exampleQuestions.length
          ? `   exampleQuestions: ${result.exampleQuestions.length}`
          : ""),
    );
    if (result.warnings.length) {
      lines.push("");
      lines.push(yellow(`${result.warnings.length} warning(s):`));
      lines.push(...renderWarnings(result.warnings));
    }
    return lines.join("\n");
  }

  lines.push(red(`✘ Invalid tutor`) + dim(` — ${source}`));
  lines.push("");
  lines.push(red(`${result.errors.length} error(s):`));
  lines.push(...renderErrors(result.errors));
  if (result.warnings.length) {
    lines.push("");
    lines.push(yellow(`${result.warnings.length} warning(s):`));
    lines.push(...renderWarnings(result.warnings));
  }
  return lines.join("\n");
}

/** Same renderer, for a standalone fragment-FILE check (`--kind fragment`). */
export function formatFragmentResult(result: FragmentCheckResult, source: string): string {
  const lines: string[] = [];

  if (result.ok) {
    lines.push(green(`✔ Valid fragment file`) + dim(` — ${source}`));
    lines.push(`  id: ${result.fragmentFileId}`);
    lines.push(
      `  fragments: ${result.fragmentIds.length}` +
        (result.fragmentIds.length ? ` (${result.fragmentIds.join(", ")})` : ""),
    );
    if (result.warnings.length) {
      lines.push("");
      lines.push(yellow(`${result.warnings.length} warning(s):`));
      lines.push(...renderWarnings(result.warnings));
    }
    return lines.join("\n");
  }

  lines.push(red(`✘ Invalid fragment file`) + dim(` — ${source}`));
  lines.push("");
  lines.push(red(`${result.errors.length} error(s):`));
  lines.push(...renderErrors(result.errors));
  if (result.warnings.length) {
    lines.push("");
    lines.push(yellow(`${result.warnings.length} warning(s):`));
    lines.push(...renderWarnings(result.warnings));
  }
  return lines.join("\n");
}
