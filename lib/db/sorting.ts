// Shared column sorting for the "filtered list" pages (see `docs/filtered-lists.md`).
// The point is the same one filtering and paging already make: the ORDER BY is part
// of the SQL query, so a sort spans the WHOLE filtered set — not just the twenty
// rows the current page happens to render. The sort lives in the URL (`?sort=`), so
// it is shareable and back-button friendly like every other list param.
//
// This is the URL half, and like `lib/db/paging.ts` it is deliberately free of any
// database or drizzle import: `components/data-list.tsx` renders the header links
// from `sortHref`, and components import only DB-free `lib/db` modules. (The client
// `components/list-filter-bar.tsx` also uses `formatSort`, which makes the rule bite
// twice.) The drizzle half — turning a parsed sort into ORDER BY terms — is
// `lib/db/sort-order.ts`.

import { carryParams, type ParamRecord } from "@/lib/db/paging";

export type SortDirection = "asc" | "desc";

/** One column sort. `undefined` anywhere means "the list's default order". */
export interface Sort {
  /** A key from the list's own `SORT_COLUMNS` map — never a raw column name. */
  key: string;
  dir: SortDirection;
}

/** The sorting half of a list page's `searchParams` type, so pages don't restate it. */
export type SortParams = { sort?: string | string[] };

/** `name` / `-name` — the inverse of `parseSort`. */
export function formatSort(sort: Sort): string {
  return sort.dir === "desc" ? `-${sort.key}` : sort.key;
}

/**
 * Reads `?sort=` off an awaited searchParams bag; a leading `-` means descending.
 *
 * `allowed` is the list's sort-key → column map, which the store owns and exports —
 * so the set of sortable keys is declared exactly once. A key outside it (a typo, a
 * hand-edited URL, a bookmark from before a column was dropped) reads as no sort
 * instead of reaching the query. `Object.hasOwn`, not `in`: `?sort=toString` must
 * not match a prototype key.
 */
export function parseSort(sp: ParamRecord, allowed: Record<string, unknown>): Sort | undefined {
  const raw = (Array.isArray(sp.sort) ? sp.sort[0] : sp.sort)?.trim();
  if (!raw) return undefined;
  const dir: SortDirection = raw.startsWith("-") ? "desc" : "asc";
  const key = dir === "desc" ? raw.slice(1) : raw;
  return Object.hasOwn(allowed, key) ? { key, dir } : undefined;
}

/**
 * The three-state header cycle: a fresh column starts ascending, a second click
 * flips it to descending, a third clears the sort (back to the default order).
 */
export function nextSort(current: Sort | undefined, key: string): Sort | undefined {
  if (current?.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : undefined;
}

/**
 * The list URL for the NEXT state of `key`'s cycle, preserving every other search
 * param — `size` included, on purpose. Only `page` is dropped: page 7 of a re-sorted
 * list holds different rows, so carrying it over would be meaningless.
 */
export function sortHref(
  pathname: string,
  sp: ParamRecord,
  key: string,
  current: Sort | undefined,
): string {
  const params = carryParams(sp, ["page", "sort"]);
  const next = nextSort(current, key);
  if (next) params.set("sort", formatSort(next));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
