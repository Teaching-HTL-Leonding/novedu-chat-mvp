// Shared pagination for the "filtered list" pages (see `docs/filtered-lists.md`).
// The point mirrors the filtering rule: the SKIP and the LIMIT are part of the
// SQL query — never an in-memory `slice()` — so a list stays cheap as the data
// grows. The page lives in the URL (`?page=`, plus a `?size=` override), so it
// is shareable and back-button friendly like every other filter param.
//
// This module is deliberately free of any database import: `components/data-list.tsx`
// pulls `pageHref`/`ParamRecord` in to render the pager, and no driver code may
// reach the component graph. If a third URL-shaped helper ever shows up here,
// that is the signal to split the URL half into its own module.

/** Rows per page unless a `?size=` override says otherwise. */
export const DEFAULT_PAGE_SIZE = 20;

/** Upper bound for `?size=` — it caps the work a hand-edited URL can ask for. */
export const MAX_PAGE_SIZE = 100;

/** What a store needs to fetch one page. Absent means "everything". */
export interface Paging {
  /** 1-based. */
  page: number;
  pageSize: number;
}

/** One page of a list, plus the exact total the filter matched. */
export interface PagedResult<T> {
  rows: T[];
  /** Exact COUNT over the SAME conditions as `rows`; `rows.length` when unpaged. */
  total: number;
  /**
   * The EFFECTIVE page — clamped into range, so it can differ from the requested
   * `?page=`. Every pager href must derive from THIS, never from the URL, or a
   * clamped page would offer a "Next" that does not exist.
   */
  page: number;
  pageSize: number;
}

/** The search-param bag a Next page hands over after `await searchParams`. */
export type ParamRecord = Record<string, string | string[] | undefined>;

/** The paging half of a list page's `searchParams` type, so pages don't restate it. */
export type PagingParams = { page?: string | string[]; size?: string | string[] };

/**
 * The envelope for an UNPAGED read: everything matched, so the row count IS the
 * total. Exported because the store tests build the same envelope for their mocks —
 * the shape is named once here instead of five times over there.
 */
export function unpagedResult<T>(rows: T[]): PagedResult<T> {
  // `pageSize` is never 0: it would poison `lastPage()` with a divide-by-zero.
  return { rows, total: rows.length, page: 1, pageSize: Math.max(rows.length, 1) };
}

/** First-wins, matching how the pages read their own params (`typeof sp.q === "string"`). */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | string[] | undefined): number | undefined {
  const raw = firstValue(value)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return parsed >= 1 ? parsed : undefined;
}

/**
 * Reads `?page=` / `?size=` off an awaited searchParams bag. Anything
 * unparseable — blank, non-numeric, zero, negative — falls back to the default;
 * `size` is additionally capped at `MAX_PAGE_SIZE`. `size=1` is deliberately
 * legal: it is how the e2e suite forces a multi-page list out of two rows.
 *
 * Only the lower bound is applied to `page` here — clamping to the LAST page
 * needs the total, so it happens in `paginate`.
 */
export function parsePaging(sp: ParamRecord): Paging {
  const size = parsePositiveInt(sp.size);
  return {
    page: parsePositiveInt(sp.page) ?? 1,
    pageSize: size === undefined ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE),
  };
}

/**
 * The list URL for `page`, preserving every other search param. `page` is
 * omitted at 1 and `size` at the default, so the first page's URL matches what
 * `ListFilterBar` produces on Apply.
 */
export function pageHref(
  pathname: string,
  sp: ParamRecord,
  page: number,
  pageSize: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (key === "page" || key === "size") continue;
    const first = firstValue(value);
    if (first) params.set(key, first);
  }
  if (page > 1) params.set("page", String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set("size", String(pageSize));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** The last 1-based page for a total — at least 1, so an empty list still has a page 1. */
export function lastPage(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Runs the COUNT and the row query for one page.
 *
 * The two run in PARALLEL, so a paged list costs one round-trip of latency, not
 * two. The row query is re-issued ONCE — never in a loop — when the requested
 * page over-shot the data, which self-heals a stale `?page=` (e.g. the last
 * page's rows were bulk-deleted and `router.refresh()` re-rendered the same URL).
 *
 * COUNT and rows are not in one transaction, so `total` is a snapshot that can
 * drift by a row against `rows`. That is fine for a teacher list — but it is why
 * `DataList` keys its empty state on `rows.length`, not on `total`.
 *
 * Errors are NOT swallowed here: each store keeps its own try/catch that turns an
 * unreachable database into `undefined`.
 *
 * `rows` must build a FRESH query chain on every call — drizzle builders are
 * stateful, and the over-shoot path invokes the closure twice.
 */
export async function paginate<T>(args: {
  paging: Paging | undefined;
  count: () => Promise<number>;
  rows: (window?: { offset: number; limit: number }) => Promise<T[]>;
}): Promise<PagedResult<T>> {
  const { paging, count, rows } = args;

  // Unpaged callers (the bearer API routes) pay for no COUNT at all.
  if (!paging) return unpagedResult(await rows());

  const { pageSize } = paging;
  const [total, firstTry] = await Promise.all([
    count(),
    rows({ offset: (paging.page - 1) * pageSize, limit: pageSize }),
  ]);

  if (firstTry.length > 0 || total === 0) {
    // `total === 0` reports page 1 whatever was asked for, so a consumer building
    // hrefs from `PagedResult.page` never sees an out-of-range page.
    return { rows: firstTry, total, page: total === 0 ? 1 : paging.page, pageSize };
  }

  const clamped = lastPage(total, pageSize);
  return {
    rows: await rows({ offset: (clamped - 1) * pageSize, limit: pageSize }),
    total,
    page: clamped,
    pageSize,
  };
}
