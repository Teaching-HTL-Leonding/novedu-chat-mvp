// Pure name/kind helpers for app-hosted YAML files. Extracted from
// `lib/file-store.ts` so they can be shared by code that must NOT pull in the
// database (the store is server-only): the public GET route, the create action,
// AND the client-safe `@/lib/yaml-files` API the student GUI imports.
//
// PURE — no imports, no I/O. Safe to import from client components.

/** Allowed file-name shape: letters, digits, underscore, hyphen — no spaces, max 100. */
export const FILE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export type FileKind = "tutor" | "fragment";

export function isFileKind(value: unknown): value is FileKind {
  return value === "tutor" || value === "fragment";
}

export type FileNameValidation = { ok: true; name: string } | { ok: false; message: string };

/**
 * Validates and normalizes a raw file-name input (trims surrounding whitespace,
 * then enforces {@link FILE_NAME_PATTERN}). Pure, so the GET route, the create
 * action, and the student GUI share exactly one definition of a legal name.
 */
export function validateFileName(name: unknown): FileNameValidation {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!FILE_NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      message:
        "The name may contain only letters, digits, underscores and hyphens (max 100 characters) — no spaces.",
    };
  }
  return { ok: true, name: trimmed };
}
