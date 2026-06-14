// Standalone fragment-FILE checks: given an already-schema-validated `FragmentFile`,
// confirm its fragment ids are unique and every `content` template renders against
// its own declared `input_schema`. Pure: no network, no YAML — the I/O wrapper
// (`loadAndCheckFragmentFile`) lives in `load.ts`.
//
// These same checks back two callers: the `--kind fragment` / "Fragment library"
// path (a library author validating their file directly), and thorough tutor
// validation, which strict-renders EVERY fragment in EVERY referenced library
// (`checkFragmentTemplates`, opt-in via `validateLibraries`). Duplicate-id stays
// owned here for the standalone path; on the tutor path `checkConsistency` already
// reports it, so the whole-library pass uses `checkFragmentTemplates` ONLY (no
// double-report).

import Handlebars from "handlebars";
import { COMPILE_OPTIONS } from "./assemble";
import {
  error,
  type FragmentCheckResult,
  type ValidationError,
  type ValidationWarning,
} from "./errors";
import { validate } from "./parse";
import { type Fragment, type FragmentFile, FragmentFileSchema, type InputSchema } from "./schemas";

type DeclaredProperty = InputSchema["properties"][string];

/**
 * A placeholder value for a declared input, shaped to its type so the template
 * actually exercises it: a string renders, a boolean drives `{{#if}}`, an array
 * makes `{{#each}}` run its body (so references inside the loop are checked too). We
 * deliberately ignore the fragment's real `default`s — we only need *some* value of
 * the right shape, so that strict rendering throws solely on variables the fragment
 * never declares.
 */
function placeholder(prop: DeclaredProperty): string | boolean | string[] {
  switch (prop.type) {
    case "string":
      return "x";
    case "boolean":
      return true;
    case "array":
      return ["x"];
  }
}

/** Synthetic render context = every declared property name → a typed placeholder. */
function placeholderContext(fragment: Fragment): Record<string, string | boolean | string[]> {
  const ctx: Record<string, string | boolean | string[]> = {};
  for (const [name, prop] of Object.entries(fragment.input_schema?.properties ?? {})) {
    ctx[name] = placeholder(prop);
  }
  return ctx;
}

/**
 * Strict-render each fragment's `content` against a context built from its own
 * `input_schema`. A throw — a Handlebars syntax error, or `strict` mode hitting a
 * variable not in the context (one the fragment never declares) — becomes a
 * `FRAGMENT_TEMPLATE_ERROR`. Uses the SAME compile options as real prompt assembly
 * (`assemble.ts`), so passing here ⟺ rendering inside a tutor. `fileAlias`/`url` are
 * stamped for attribution when this runs as part of a tutor's whole-library check.
 */
export function checkFragmentTemplates(
  file: FragmentFile,
  opts: { fileAlias?: string; url?: string } = {},
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  for (const fragment of file.fragments) {
    try {
      const template = Handlebars.compile(fragment.content, COMPILE_OPTIONS);
      template(placeholderContext(fragment));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(
        error("FRAGMENT_TEMPLATE_ERROR", `Fragment "${fragment.id}" failed to render: ${message}`, {
          fragmentId: fragment.id,
          fileAlias: opts.fileAlias,
          url: opts.url,
        }),
      );
    }
  }
  return { errors, warnings: [] };
}

/**
 * Fragment ids declared more than once within a single file. The standalone
 * validator runs this directly; the tutor path gets the same check from
 * `checkConsistency` (so the whole-library pass must NOT repeat it).
 */
export function findDuplicateFragmentIds(file: FragmentFile): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  for (const fragment of file.fragments) {
    if (seen.has(fragment.id)) {
      errors.push(
        error(
          "DUPLICATE_FRAGMENT_ID_IN_FILE",
          `Fragment "${fragment.id}" is declared more than once`,
          { fragmentId: fragment.id },
        ),
      );
      continue;
    }
    seen.add(fragment.id);
  }
  return errors;
}

/**
 * Validate a fragment FILE on its own: schema → unique ids → every template renders.
 * Pure (the parsed value is passed in); `loadAndCheckFragmentFile` in `load.ts` wraps
 * it with fetch + YAML parse. On success, reports the file id and its fragment ids.
 */
export function checkFragmentFileValue(parsed: unknown, url?: string): FragmentCheckResult {
  const valid = validate<FragmentFile>(
    parsed,
    FragmentFileSchema,
    "FRAGMENT_FILE_SCHEMA_ERROR",
    url,
  );
  if (!valid.ok) return { ok: false, errors: [valid.error], warnings: [] };
  const file = valid.data;

  const errors = [
    ...findDuplicateFragmentIds(file),
    ...checkFragmentTemplates(file, { url }).errors,
  ];
  if (errors.length > 0) return { ok: false, errors, warnings: [] };

  return {
    ok: true,
    fragmentFileId: file.id,
    fragmentIds: file.fragments.map((f) => f.id),
    warnings: [],
  };
}
