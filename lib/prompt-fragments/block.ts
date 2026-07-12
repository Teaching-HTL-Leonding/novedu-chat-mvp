// Lenient reader for the document-level fragment block, shared by the runtime
// parsers of every activity kind (quiz / writing / coding). Handlebars-free (safe
// for the lenient `*-yaml.ts` parsers) and deliberately permissive: it passes the
// declared `fragment_files` / `fragments` arrays through as-is; any structural
// problem is caught later, fail-closed, by `assembleFragmentPrompt` at resolve time
// (a malformed block errors the load rather than silently dropping a safety rule).

import type { FragmentBlock, FragmentFileRef, FragmentRef } from "./schemas";

/**
 * The consumed/empty block a runtime loader leaves behind after resolving fragments into
 * its own field (`Quiz.fragmentPreamble`, or folded into writing/coding `instructions`),
 * so no stale unresolved block lingers as a second source of truth on the loaded object.
 */
export const EMPTY_FRAGMENT_BLOCK: FragmentBlock = { fragment_files: [], fragments: [] };

export function readFragmentBlock(root: Record<string, unknown>): FragmentBlock {
  const fragment_files = Array.isArray(root.fragment_files)
    ? (root.fragment_files as FragmentFileRef[])
    : [];
  const fragments = Array.isArray(root.fragments) ? (root.fragments as FragmentRef[]) : [];
  return { fragment_files, fragments };
}
