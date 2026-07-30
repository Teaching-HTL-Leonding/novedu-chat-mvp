// Placement checking: given the inline `{{fragment}}` placements extracted from an
// activity's host text and the fetched fragment libraries, confirm every referenced
// `alias.id` resolves and every required input is supplied. Pure: no network, no
// YAML, no Handlebars.
//
// `resolveAndMerge` is the SINGLE resolve-and-validate step shared by BOTH
// `checkPlacements` (which surfaces its findings) and the host-template `fragment`
// helper (which uses its merged variables + content to render) — so validation and
// render can never drift on which fragment, which defaults, which types.

import { error, type ValidationError, type ValidationWarning, warning } from "./errors";
import type { Placement } from "./host-template";
import type {
  Fragment,
  FragmentFile,
  FragmentFileRef,
  InputSchema,
  VariableValue,
} from "./schemas";

type DeclaredProperty = InputSchema["properties"][string];

/** Compare a supplied value against its declared property type. Returns null when it matches. */
function typeMismatch(
  prop: DeclaredProperty,
  value: VariableValue,
): { expected: string; actual: string } | null {
  const actual = Array.isArray(value) ? "array" : typeof value;
  switch (prop.type) {
    case "string":
      return typeof value === "string" ? null : { expected: "string", actual };
    case "boolean":
      return typeof value === "boolean" ? null : { expected: "boolean", actual };
    case "array":
      return Array.isArray(value) && value.every((v) => typeof v === "string")
        ? null
        : { expected: "array<string>", actual };
  }
}

/** Split an inline reference at the FIRST dot: aliases cannot contain dots, ids may. */
export function splitFragmentRef(ref: string): { alias: string; fragmentId: string } {
  const dot = ref.indexOf(".");
  if (dot === -1) return { alias: ref, fragmentId: "" };
  return { alias: ref.slice(0, dot), fragmentId: ref.slice(dot + 1) };
}

/** The outcome of resolving one placement: its findings plus the data needed to render. */
export interface ResolveResult {
  errors: ValidationError[];
  warnings: ValidationWarning[];
  /** Effective variables: `input_schema` defaults overridden by the inline args. */
  variables: Record<string, VariableValue>;
  /** The fragment's `content`, or `null` when the reference did not resolve. */
  content: string | null;
}

/**
 * Resolve one `"alias.id"` reference against the fetched libraries and validate its
 * inline args against the fragment's `input_schema` — required present, types correct,
 * undeclared flagged, optional defaults filled in (a supplied value always wins). The
 * same required/type/undeclared/defaults machinery that ran per document-level ref
 * before, now per placement.
 */
export function resolveAndMerge(
  ref: string,
  args: Record<string, VariableValue>,
  filesByAlias: Map<string, FragmentFile>,
): ResolveResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const { alias, fragmentId } = splitFragmentRef(ref);

  const file = filesByAlias.get(alias);
  if (!file) {
    errors.push(
      error(
        "UNKNOWN_FRAGMENT_FILE_ALIAS",
        `Fragment marker "${ref}" uses unknown file alias "${alias}"`,
        { fileAlias: alias, fragmentId },
      ),
    );
    return { errors, warnings, variables: args, content: null };
  }

  const fragment = file.fragments.find((f) => f.id === fragmentId);
  if (!fragment) {
    errors.push(
      error("FRAGMENT_NOT_FOUND", `Fragment "${fragmentId}" not found in file "${alias}"`, {
        fileAlias: alias,
        fragmentId,
      }),
    );
    return { errors, warnings, variables: args, content: null };
  }

  const merged = mergeVariables(alias, fragment, args, errors, warnings);
  return { errors, warnings, variables: merged, content: fragment.content };
}

/** Validate `args` against `fragment.input_schema` and merge in optional defaults. */
function mergeVariables(
  alias: string,
  fragment: Fragment,
  args: Record<string, VariableValue>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): Record<string, VariableValue> {
  const merged: Record<string, VariableValue> = { ...args };
  const schema = fragment.input_schema;
  const id = fragment.id;

  if (!schema) {
    for (const name of Object.keys(args)) {
      warnings.push(
        warning(
          "UNDECLARED_VARIABLE",
          `Variable "${name}" supplied to "${id}", which declares no input schema`,
          { fileAlias: alias, fragmentId: id, variable: name },
        ),
      );
    }
    return merged;
  }

  for (const name of schema.required) {
    if (!(name in args)) {
      errors.push(
        error(
          "MISSING_REQUIRED_VARIABLE",
          `Fragment "${id}" requires variable "${name}", which is not supplied`,
          { fileAlias: alias, fragmentId: id, variable: name },
        ),
      );
    }
  }

  for (const [name, value] of Object.entries(args)) {
    const prop = schema.properties[name];
    if (!prop) {
      warnings.push(
        warning(
          "UNDECLARED_VARIABLE",
          `Variable "${name}" supplied to "${id}" is not declared in its input schema`,
          { fileAlias: alias, fragmentId: id, variable: name },
        ),
      );
      continue;
    }
    const mismatch = typeMismatch(prop, value);
    if (mismatch) {
      errors.push(
        error(
          "VARIABLE_TYPE_MISMATCH",
          `Variable "${name}" of "${id}" should be ${mismatch.expected} but got ${mismatch.actual}`,
          {
            fileAlias: alias,
            fragmentId: id,
            variable: name,
            expectedType: mismatch.expected,
            actualType: mismatch.actual,
          },
        ),
      );
    }
  }

  // Fill in defaults for optional inputs the placement didn't supply. A `default` on a
  // `required` input can never apply (the required check above already fired if it was
  // absent), so flag that as a likely authoring mistake instead of injecting it.
  const requiredSet = new Set(schema.required);
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop.default === undefined) continue;
    if (requiredSet.has(name)) {
      warnings.push(
        warning(
          "REQUIRED_PROPERTY_HAS_DEFAULT",
          `Variable "${name}" of "${id}" is required, so its default is never used`,
          { fileAlias: alias, fragmentId: id, variable: name },
        ),
      );
      continue;
    }
    if (!(name in merged)) merged[name] = prop.default; // a supplied value wins
  }

  return merged;
}

export interface PlacementCheckResult {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Cross-check every inline placement against the declared libraries: duplicate
 * aliases, duplicate fragment ids within a file, each placement's `alias.id`
 * resolution + variable validation (via `resolveAndMerge`), and a warning for any
 * declared library no placement ever uses. Errors block the build; the rest are
 * warnings. Order-independent — placements carry their own textual position.
 */
export function checkPlacements(
  placements: Placement[],
  filesByAlias: Map<string, FragmentFile>,
  fileRefs: FragmentFileRef[],
): PlacementCheckResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Duplicate fragment-file aliases (read from the raw declaration list).
  const aliasCounts = new Map<string, number>();
  for (const ref of fileRefs) aliasCounts.set(ref.id, (aliasCounts.get(ref.id) ?? 0) + 1);
  for (const [alias, count] of aliasCounts) {
    if (count > 1) {
      errors.push(
        error(
          "DUPLICATE_FRAGMENT_FILE_ALIAS",
          `Fragment-file alias "${alias}" is declared ${count} times`,
          { fileAlias: alias },
        ),
      );
    }
  }

  // 2. Duplicate fragment ids within a single file.
  for (const [alias, file] of filesByAlias) {
    const seen = new Set<string>();
    for (const frag of file.fragments) {
      if (seen.has(frag.id)) {
        errors.push(
          error(
            "DUPLICATE_FRAGMENT_ID_IN_FILE",
            `Fragment "${frag.id}" is declared more than once in file "${alias}"`,
            { fileAlias: alias, fragmentId: frag.id },
          ),
        );
        continue;
      }
      seen.add(frag.id);
    }
  }

  // 3. Resolve + validate each placement.
  const usedAliases = new Set<string>();
  for (const placement of placements) {
    usedAliases.add(splitFragmentRef(placement.ref).alias);
    const resolved = resolveAndMerge(placement.ref, placement.args, filesByAlias);
    errors.push(...resolved.errors);
    warnings.push(...resolved.warnings);
  }

  // 4. A declared library that no marker ever draws from — a likely leftover / typo.
  for (const ref of fileRefs) {
    if (!usedAliases.has(ref.id)) {
      warnings.push(
        warning(
          "UNUSED_FRAGMENT_FILE",
          `Fragment library "${ref.id}" is declared but no {{fragment}} marker uses it`,
          { fileAlias: ref.id },
        ),
      );
    }
  }

  return { errors, warnings };
}
