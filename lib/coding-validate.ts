// The coding AUTHORING validator — the coding counterpart to `loadAndCheckWriting`
// in `lib/writing-validate`. Strict schema (`CodingYamlSchema`) surfaced as
// structured `ValidationError[]` that BLOCK an invalid save. Wired into the
// validator seam (`lib/file-validators.ts`) and the `@novedu/cli validate --kind
// coding` command.
//
// PURE / CLI-safe: imports only `lib/tutors` helpers (the shared scheme-gated YAML
// load, the Zod-validate wrapper, the error model) and the Zod schema — never
// `lib/coding-fetch` (DB-backed) or any server-only module. The lenient runtime
// `parseCoding` (`lib/coding-yaml.ts`) is unchanged and separate.
//
// Coding is ALWAYS anonymous (the OpenAI-compatible API path carries no per-student
// identity), so — unlike quiz/writing — this validator carries no anonymity flag;
// the file-validator seam freezes `anonymous: true` onto the code row.

import {
  type Fetcher,
  type LoadOptions,
  loadYaml,
  type ValidationError,
  type ValidationWarning,
  validate,
} from "@/lib/tutors";
import { type CodingYaml, CodingYamlSchema } from "./coding-schema";

/**
 * The result of checking a coding file. Mirrors `lib/writing-validate`'s
 * `WritingCheckResult`, minus the anonymity flag (coding is always anonymous). It
 * carries the display title the validator seam denormalizes onto the code row.
 */
export type CodingCheckResult =
  | {
      ok: true;
      codingId: string;
      model: string;
      title: string | null;
      warnings: ValidationWarning[];
    }
  | { ok: false; errors: ValidationError[]; warnings: ValidationWarning[] };

/**
 * Validate an already-parsed coding value against its schema, then extract metadata.
 * Pure (the parsed value is passed in); `loadAndCheckCoding` wraps it with fetch +
 * YAML parse.
 */
export function checkCodingValue(parsed: unknown, url?: string): CodingCheckResult {
  const valid = validate<CodingYaml>(parsed, CodingYamlSchema, "CODING_SCHEMA_ERROR", url);
  if (!valid.ok) return { ok: false, errors: [valid.error], warnings: [] };
  const coding = valid.data;

  return {
    ok: true,
    codingId: coding.id,
    model: coding.llm.model,
    title: coding.title ?? null,
    warnings: [],
  };
}

/**
 * Validate a coding FILE: scheme-gate + fetch + parse (shared `loadYaml`), then the
 * pure `checkCodingValue`. The web app passes the default http(s)-only schemes; the
 * CLI adds `file:` so a local coding YAML on disk validates too.
 */
export async function loadAndCheckCoding(
  url: string,
  fetchImpl: Fetcher,
  opts: LoadOptions = {},
): Promise<CodingCheckResult> {
  const yaml = await loadYaml(url, fetchImpl, opts);
  if (!yaml.ok) return { ok: false, errors: [yaml.error], warnings: [] };
  return checkCodingValue(yaml.value, url);
}
