import { type AnyColumn, or, type SQL, sql } from "drizzle-orm";

// A reusable "contains" filter for the DB-side list filtering (see
// `docs/filtered-lists.md`). The point is that list filtering happens IN THE
// DATABASE — never in memory — so this builds a parameterized SQL condition that
// the store passes straight into `.where(and(...))`.
//
// Postgres's `LIKE` is case-sensitive, so a case-insensitive "contains" match
// needs `ILIKE` instead — no `LOWER()` needed. We DO escape the LIKE wildcards
// (`%`, `_`) in the user's term so a search for "50%" looks for a literal "50%",
// not "starts with 50". The escape character is a backslash, declared per-column
// with `ESCAPE '\'`.

const LIKE_ESCAPE_CHAR = "\\";

// Escape the LIKE metacharacters in a raw user term. Backslash MUST be escaped
// first (it is the escape char itself), then the wildcards. Exported for unit
// tests.
export function escapeLikeTerm(term: string): string {
  return term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * Builds a case-insensitive "contains" condition over one or more columns —
 * `col1 ILIKE %term% OR col2 ILIKE %term% …`, with LIKE wildcards in `term`
 * escaped. Returns `undefined` for an empty/blank term (so the caller simply
 * omits the filter), and for an empty column list. Designed to drop into the
 * Drizzle conditional-filter pattern: `where(and(...conditions))`.
 */
export function containsAny(term: string, columns: AnyColumn[]): SQL | undefined {
  const trimmed = term.trim();
  if (trimmed === "" || columns.length === 0) return undefined;
  const pattern = `%${escapeLikeTerm(trimmed)}%`;
  return or(...columns.map((column) => sql`${column} ILIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}`));
}
