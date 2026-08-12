// The pure half of a list's OWNER filter (see `docs/filtered-lists.md`): the URL
// grammar and the option shape, with no drizzle and no `lib/db/index.ts` import —
// `components/list-filter-bar.tsx` is a CLIENT component and renders the control,
// the same split as `lib/db/sorting.ts` vs `lib/db/sort-order.ts` (and
// `lib/db/paging.ts` vs `lib/db/count.ts`). The query that reads the options lives
// in `lib/db/owners.ts`.
//
// "Owner" is the user-facing word on every list. On `/codes` it is literally the
// creating teacher (`created_by` never changes there); on `/files` and `/images`
// the tables are append-only, so the active row's `created_by` is whoever saved
// the item LAST. One word, defined for teachers in the guide.

/** The `?owner=` value that means "every owner" — the only non-oid one. */
export const ALL_OWNERS = "all";

/** One entry of an owner dropdown: the oid to filter by and what to show for it. */
export interface OwnerOption {
  /** The Entra `oid` stored in the list table's `created_by`. */
  userId: string;
  /** `novedu_users.display_name`, or the raw oid when that user has no row yet. */
  label: string;
}

// A type alias, not an interface, for the same reason as `PagingParams` and
// `SortParams`: only an alias keeps the implicit index signature that lets a page's
// intersected `searchParams` still satisfy `ParamRecord`.
/** The `searchParams` slice this filter owns. */
export type OwnerParams = { owner?: string | string[] };

/**
 * Reads `?owner=` into the two things a list page needs: the `<select>`'s value and
 * the store's `createdBy` filter.
 *
 * The grammar leans on `ListFilterBar`: an absent or empty param means the CURRENT
 * USER, so the default view has no query string at all — and "Clear"
 * (`router.push(pathname)`) therefore returns to the signed-in teacher's own items
 * without a line of code. `ALL_OWNERS` drops the filter; anything else is taken as
 * an oid VERBATIM — an unknown one simply matches nothing, and the caller renders it
 * as its own option so the control never disagrees with the URL. A repeated param is
 * first-wins, like `parseSort` and `parsePaging`.
 */
export function parseOwner(
  sp: OwnerParams,
  currentUserId: string,
): { value: string; createdBy: string | undefined } {
  const raw = (Array.isArray(sp.owner) ? sp.owner[0] : sp.owner)?.trim() ?? "";
  if (raw === "") return { value: "", createdBy: currentUserId || undefined };
  if (raw === ALL_OWNERS) return { value: ALL_OWNERS, createdBy: undefined };
  return { value: raw, createdBy: raw };
}
