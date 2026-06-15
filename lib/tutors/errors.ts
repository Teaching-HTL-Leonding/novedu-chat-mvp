// Error and result model for the tutor validator/builder core.
//
// This module is framework-agnostic (no React/Next). Every consumer — the API
// route, future server code, tests — speaks in terms of these structured
// errors and the `BuildResult` discriminated union, never thrown exceptions.

/** Hard failures that prevent a system prompt from being built. */
export type ErrorCode =
  | "INVALID_URL"
  | "FETCH_FAILED"
  | "YAML_PARSE_ERROR"
  | "TUTOR_SCHEMA_ERROR"
  | "FRAGMENT_FILE_SCHEMA_ERROR"
  | "DUPLICATE_FRAGMENT_FILE_ALIAS"
  | "DUPLICATE_FRAGMENT_ID_IN_FILE"
  | "UNKNOWN_FRAGMENT_FILE_ALIAS"
  | "FRAGMENT_NOT_FOUND"
  | "MISSING_REQUIRED_VARIABLE"
  | "VARIABLE_TYPE_MISMATCH"
  | "DUPLICATE_PRIORITY"
  | "ASSEMBLY_ERROR"
  // A fragment's `content` template failed to compile or strict-render against its
  // own declared `input_schema` — a Handlebars syntax error or a reference to a
  // variable the fragment never declares. Surfaced by the standalone fragment
  // check and by thorough tutor validation (whole-library check).
  | "FRAGMENT_TEMPLATE_ERROR";

/** Non-fatal smells: the prompt still builds, but something is worth flagging. */
export type WarningCode =
  | "UNDECLARED_VARIABLE"
  | "DUPLICATE_FRAGMENT_REFERENCE"
  | "REQUIRED_PROPERTY_HAS_DEFAULT";

export interface ValidationError {
  code: ErrorCode;
  /** Human-readable explanation, safe to show in the UI. */
  message: string;
  /** Which remote file the error concerns (fetch/YAML/schema errors). */
  url?: string;
  /** The tutor-side fragment-file alias (e.g. `general_fragments`). */
  fileAlias?: string;
  /** The fragment id within that file (e.g. `socratic_tutor`). */
  fragmentId?: string;
  /** The offending variable name (missing/typed wrong). */
  variable?: string;
  expectedType?: string;
  actualType?: string;
  /** HTTP status for FETCH_FAILED. */
  status?: number;
  /** Zod's treeified issues for *_SCHEMA_ERROR (machine + human readable). */
  zodIssues?: unknown;
}

export interface ValidationWarning {
  code: WarningCode;
  message: string;
  fileAlias?: string;
  fragmentId?: string;
  variable?: string;
}

/**
 * The single result type returned by the high-level entry point. A discriminated
 * union on `ok` so callers get either a prompt or a complete error list — never
 * both, never a thrown exception.
 */
export type BuildResult =
  | {
      ok: true;
      prompt: string;
      model: string;
      /** Whether students may attach images in the chat (tutor `llm.imageInput`, default true). */
      imageInput: boolean;
      /**
       * When true (the default), the user↔chat link is NOT persisted — chats
       * stay anonymous. A tutor opts into attribution with `anonymous: false`.
       */
      anonymous: boolean;
      /** Optional student-facing greeting shown instead of the chat's default welcome text. */
      title?: string;
      /** Student-facing description, rendered below the welcome greeting. */
      description: string;
      /**
       * Tutor `exampleQuestions`, normalized to [] when absent. Shown on the
       * welcome screen. The inline shape mirrors `ExampleQuestion` in
       * `schemas.ts` (kept inline so this module stays import-free) — update
       * both together.
       */
      exampleQuestions: { title: string; question: string }[];
      warnings: ValidationWarning[];
    }
  | { ok: false; errors: ValidationError[]; warnings: ValidationWarning[] };

/**
 * Result of validating a fragment FILE on its own (the `--kind fragment` / "Fragment
 * library" path). Mirrors `BuildResult`'s discriminated shape, but a fragment file
 * has no assembled prompt — on success it just reports what it contains. Callers know
 * which kind they asked for, so there is no `kind` discriminator here.
 */
export type FragmentCheckResult =
  | {
      ok: true;
      /** The fragment file's own `id`. */
      fragmentFileId: string;
      /** Every fragment id declared in the file, in document order. */
      fragmentIds: string[];
      warnings: ValidationWarning[];
    }
  | { ok: false; errors: ValidationError[]; warnings: ValidationWarning[] };

/** Small helper to build an error object tersely at call sites. */
export function error(
  code: ErrorCode,
  message: string,
  extra: Partial<ValidationError> = {},
): ValidationError {
  return { code, message, ...extra };
}

export function warning(
  code: WarningCode,
  message: string,
  extra: Partial<ValidationWarning> = {},
): ValidationWarning {
  return { code, message, ...extra };
}

// The shape `z.treeifyError` produces (a `ValidationError`'s `zodIssues`):
// per-node `errors`, with nested `properties` (objects) and `items` (arrays).
type ZodErrorTree = {
  errors?: string[];
  properties?: Record<string, ZodErrorTree>;
  items?: (ZodErrorTree | null)[];
};

/**
 * Flattens a treeified Zod error into `path: message` lines so a generic
 * "Document does not match the expected structure" becomes actionable — e.g.
 * `Unrecognized key: "nae"` and `name: Invalid input: expected string`.
 * Framework-agnostic: shared by the web UI (`ErrorList`), the share-tutor
 * action, and the CLI formatter, so a schema error reads the same everywhere.
 */
export function formatZodIssues(zodIssues: unknown): string[] {
  const out: string[] = [];
  const walk = (node: ZodErrorTree | null | undefined, path: string[]) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.errors)) {
      for (const message of node.errors) {
        out.push(path.length ? `${path.join(".")}: ${message}` : message);
      }
    }
    if (node.properties) {
      for (const [key, child] of Object.entries(node.properties)) walk(child, [...path, key]);
    }
    if (Array.isArray(node.items)) {
      node.items.forEach((child, index) => {
        walk(child, [...path, String(index)]);
      });
    }
  };
  walk(zodIssues as ZodErrorTree, []);
  return out;
}
