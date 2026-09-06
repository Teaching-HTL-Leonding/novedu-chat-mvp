import { asc, desc, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Sort } from "@/lib/db/sorting";

// The drizzle half of a sortable list (see `docs/filtered-lists.md`). Every list
// store turns the same parsed `?sort=` into the same ORDER BY, so that lives here
// once instead of four times. Split from `lib/db/sorting.ts` because that module is
// imported by `components/data-list.tsx` and by the client filter bar, and
// components import only DB-free `lib/db` modules — the same split as
// `lib/db/count.ts` vs `lib/db/paging.ts`.

/** A list's sortable columns: URL sort key → the column it orders by. */
export type SortColumns = Record<string, SQLWrapper>;

/**
 * A list's complete ORDER BY: the sorted column (or the list's default order when
 * nothing is sorted), always closed by `tiebreaker`.
 *
 * Two rules live here so no list can get them wrong:
 *
 * - An explicit sort REPLACES `fallback` rather than layering on top of it. The
 *   tiebreaker already resolves ties deterministically, so a second, invisible sort
 *   key would only obscure the ordering.
 * - `tiebreaker` — a UNIQUE column, the table's primary key — always comes last. It
 *   is what keeps `LIMIT/OFFSET` from repeating or skipping a row between pages, so
 *   it is a parameter rather than something each store remembers to append.
 *
 * An unknown key normally cannot arrive — `parseSort` validates against this same
 * map — so falling back rather than throwing just keeps a store that was called
 * directly on its never-throw contract.
 */
export function sortOrder(
  sort: Sort | undefined,
  columns: SortColumns,
  fallback: SQL[],
  tiebreaker: SQL,
): SQL[] {
  const column = sort && columns[sort.key];
  if (!column) return [...fallback, tiebreaker];
  return [sort.dir === "desc" ? desc(column) : asc(column), tiebreaker];
}
