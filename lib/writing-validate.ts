// The writing AUTHORING validator — the writing counterpart to
// `loadAndCheckFragmentFile` in `lib/tutors`. Strict schema (`WritingYamlSchema`)
// surfaced as structured `ValidationError[]` that BLOCK an invalid save. Wired into
// the validator seam (`lib/file-validators.ts`) and the `@novedu/cli validate
// --kind writing` command.
//
// PURE / CLI-safe: imports only `lib/tutors` helpers (the shared scheme-gated YAML
// load, the Zod-validate wrapper, the error model) and the Zod schema — never
// `lib/writing-fetch` (DB-backed) or any server-only module. The lenient runtime
// `parseWriting` (`lib/writing-yaml.ts`) is unchanged and separate.

import {
  assembleFragmentPrompt,
  type Fetcher,
  type LoadOptions,
  loadYaml,
  type ValidationError,
  type ValidationWarning,
  validate,
} from "@/lib/prompt-fragments";
import type { LlmProvider } from "./llm/provider";
import { type WritingYaml, WritingYamlSchema } from "./writing-schema";

/**
 * The result of checking a writing file. Mirrors `lib/tutors`' `FragmentCheckResult`,
 * but a writing activity also carries the metadata the validator seam denormalizes
 * onto the code row: the privacy flag and a display title.
 */
export type WritingCheckResult =
  | {
      ok: true;
      writingId: string;
      model: string;
      /** The LLM provider serving `model` (`llm.provider`, default SCCH). */
      provider: LlmProvider;
      /** Privacy flag, default `false` (attributed) — the writing divergence. */
      anonymous: boolean;
      title: string | null;
      warnings: ValidationWarning[];
    }
  | { ok: false; errors: ValidationError[]; warnings: ValidationWarning[] };

/** Writing DIVERGES from tutor/quiz: it defaults to attributed (`anonymous: false`). */
const DEFAULT_ANONYMOUS = false;

/**
 * Extract metadata from an already-schema-validated writing value. Split from
 * `checkWritingValue` so `loadAndCheckWriting` can reuse the single `validate` it already
 * ran (no second parse of the same document against the same schema).
 */
function checkWritingParsed(writing: WritingYaml): WritingCheckResult {
  return {
    ok: true,
    writingId: writing.id,
    model: writing.llm.model,
    provider: writing.llm.provider,
    anonymous: writing.anonymous ?? DEFAULT_ANONYMOUS,
    title: writing.title ?? null,
    warnings: [],
  };
}

/**
 * Validate an already-parsed writing value against its schema, then extract metadata.
 * Pure (the parsed value is passed in); `loadAndCheckWriting` wraps it with fetch +
 * YAML parse.
 */
export function checkWritingValue(parsed: unknown, url?: string): WritingCheckResult {
  const valid = validate<WritingYaml>(parsed, WritingYamlSchema, "WRITING_SCHEMA_ERROR", url);
  if (!valid.ok) return { ok: false, errors: [valid.error], warnings: [] };
  return checkWritingParsed(valid.data);
}

/**
 * Validate a writing FILE: scheme-gate + fetch + parse (shared `loadYaml`), then the
 * pure `checkWritingValue`. The web app passes the default http(s)-only schemes; the
 * CLI adds `file:` so a local writing YAML on disk validates too.
 */
export async function loadAndCheckWriting(
  url: string,
  fetchImpl: Fetcher,
  opts: LoadOptions = {},
): Promise<WritingCheckResult> {
  const yaml = await loadYaml(url, fetchImpl, opts);
  if (!yaml.ok) return { ok: false, errors: [yaml.error], warnings: [] };

  // Validate the schema ONCE, then reuse the typed value for both metadata and the
  // fragment block below (no second parse of the same document).
  const valid = validate<WritingYaml>(yaml.value, WritingYamlSchema, "WRITING_SCHEMA_ERROR", url);
  if (!valid.ok) return { ok: false, errors: [valid.error], warnings: [] };

  const checked = checkWritingParsed(valid.data);
  if (!checked.ok) return checked;

  // The fragment block's authoring gate: fetch + placement checks + a host-template
  // render dry-run over `instructions` (authoring default: `validateLibraries: true`).
  const assembled = await assembleFragmentPrompt(
    { fragment_files: valid.data.fragment_files },
    url,
    fetchImpl,
    { allowedSchemes: opts.allowedSchemes, validateLibraries: opts.validateLibraries ?? true },
    valid.data.instructions,
  );
  const warnings = [...checked.warnings, ...assembled.warnings];
  if (!assembled.ok) return { ok: false, errors: assembled.errors, warnings };
  return { ...checked, warnings };
}
