/**
 * The ONE slugifier for glossary anchors, shared by the remark plugin and the
 * glossary page so links cannot drift.
 *
 * "Module / kind" → "module-kind", "Anonymous vs. per-user" → "anonymous-vs-per-user".
 */
export function slugifyTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
