// CLIENT-SAFE module metadata for the generic "codes" subsystem. PURE — no I/O,
// no server-only imports — so client components (the /codes list badge + module
// filter select, the count-column header) and the server registry can both name
// modules without pulling in agents, the database, or the validators.
//
// A `CodeModule` is a shareable activity reachable at `/<code>`. It is a SUBSET
// of `FileKind` (lib/file-name.ts): `fragment` is a file kind with a validator
// and NO module, and a future `writing` module is added here together with its
// descriptor (lib/code-modules/registry.ts) and its own student/agent code.

/** The shareable-activity modules a code can dispatch to. */
export const CODE_MODULES = ["tutor", "quiz", "writing"] as const;

export type CodeModule = (typeof CODE_MODULES)[number];

export function isCodeModule(value: unknown): value is CodeModule {
  return typeof value === "string" && (CODE_MODULES as readonly string[]).includes(value);
}

/**
 * Narrows a URL search-param value (Next gives `string | string[] | undefined`)
 * to a `CodeModule`, or `undefined` when it is absent/unrecognized. Shared by the
 * /codes list (module filter) and /codes/new (module pre-fill) so the parse lives
 * in one place.
 */
export function parseModuleParam(value: string | string[] | undefined): CodeModule | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return isCodeModule(first) ? first : undefined;
}

/** Display strings for a module, used by the teacher list (badge + count column). */
export interface CodeModuleLabels {
  /** Short badge text in the list's Module column. */
  badge: string;
  /** Header of the per-code interaction-count column (tutor chats vs quiz discussions). */
  countColumn: string;
}

export const codeModuleLabels: Record<CodeModule, CodeModuleLabels> = {
  tutor: { badge: "Tutor", countColumn: "Conversations" },
  quiz: { badge: "Quiz", countColumn: "Discussions" },
  writing: { badge: "Writing", countColumn: "Conversations" },
};
