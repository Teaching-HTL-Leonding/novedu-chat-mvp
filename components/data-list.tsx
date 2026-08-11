import Link from "next/link";
import type { ReactNode } from "react";
import { PageBody } from "@/components/page-main";
import { buttonVariants } from "@/components/ui/button";
import { lastPage, type PagedResult, type ParamRecord, pageHref } from "@/lib/db/paging";
import { cn } from "@/lib/utils";

// A column-driven list table for "filtered list" pages (see
// `docs/filtered-lists.md`). This is a SERVER component: the rows arrive
// ALREADY filtered by the database (the page reads the URL search params and
// queries with a WHERE clause), so there is no client-side filtering. Column
// `render` functions stay server-side here — no Server→Client function boundary
// is crossed — and may return client leaf components (LocalTime, copy/delete
// buttons), which hydrate normally.
//
// The table itself is the standalone <ListTable> (used directly by embedded
// tables like the per-code ConversationStats); <DataList> wraps it in the
// PageBody shell with the toolbar and empty states for full list pages.

export type ListColumnKind = "numeric" | "time" | "actions";

// The table chrome — private: every table renders through <ListTable>.
const TABLE_CLASSES = "w-full border-collapse text-sm";
const TH_CLASSES =
  "border-foreground/25 border-b-2 bg-foreground/5 px-3 py-2 text-left font-semibold text-foreground/70 text-xs uppercase tracking-wide";
const TD_CLASSES = "border-foreground/15 border-b px-3 py-2 align-middle";

// Built-in cell recipes so pages don't repeat alignment classes per column:
// numeric = right-aligned and snug (header right-aligned too), time = no wrap,
// actions = a right-aligned row of icon buttons in a snug column.
const HEADER_KIND_CLASSES: Record<ListColumnKind, string> = {
  numeric: "text-right",
  time: "",
  actions: "w-[1%]",
};

const CELL_KIND_CLASSES: Record<ListColumnKind, string> = {
  numeric: "w-[1%] whitespace-nowrap text-right",
  time: "whitespace-nowrap",
  actions: "flex items-center justify-end gap-2 whitespace-nowrap",
};

export interface ListColumn<T> {
  /** Header cell content. */
  header: ReactNode;
  /** Body cell content for one row (returns the cell content, not the <td>). */
  render: (row: T) => ReactNode;
  /** Built-in cell recipe for the column (alignment, wrapping, width). */
  kind?: ListColumnKind;
  /** Optional extra classes on the <td>, cn-merged after the kind recipe. */
  className?: string;
  /** Optional extra classes on the <th>, cn-merged after the kind recipe. */
  headerClassName?: string;
  /** Visually hide the header label (e.g. the trailing Actions column). */
  srOnlyHeader?: boolean;
}

/**
 * What the pager needs. `DataList` is a server component with no access to the
 * URL, so the page hands over its own pathname plus the already-awaited search
 * params; every param except `page`/`size` is carried onto the pager's links.
 */
export interface ListPagination {
  /** The list route's pathname, e.g. `"/files"`. */
  pathname: string;
  /** The page's awaited `searchParams`. */
  params: ParamRecord;
  /**
   * The store's `PagedResult` (structurally assignable) — `page` is the EFFECTIVE,
   * clamped page, and `total` the exact COUNT the current filter matches.
   */
  result: Pick<PagedResult<unknown>, "page" | "pageSize" | "total">;
}

export interface DataListProps<T> {
  rows: T[];
  getRowKey: (row: T) => string;
  columns: ListColumn<T>[];
  /** Optional per-row <tr> classes (e.g. the codes list's module accent stripe). */
  rowClassName?: (row: T) => string | undefined;
  /** Top-left slot — the "New …" button/link. */
  actions?: ReactNode;
  /** Top-right slot — a <ListFilterBar> with the page's filter controls. */
  filterBar?: ReactNode;
  /** Intro paragraph above the toolbar. */
  hint?: ReactNode;
  /** Whether a filter is currently applied — picks empty vs no-match copy. */
  isFiltered: boolean;
  /** Body when there are no rows AND no filter is applied. */
  emptyState: ReactNode;
  /** Body when a filter is applied but matched nothing. */
  noMatchState: ReactNode;
  /** Opt into the pager below the table (see `docs/filtered-lists.md`). */
  pagination?: ListPagination;
}

/** The bare table — column recipes included, no page shell or toolbar. */
export function ListTable<T>({
  rows,
  getRowKey,
  columns,
  rowClassName,
}: {
  rows: T[];
  getRowKey: (row: T) => string;
  columns: ListColumn<T>[];
  /** Optional per-row <tr> classes (e.g. the codes list's module accent stripe). */
  rowClassName?: (row: T) => string | undefined;
}) {
  // Cell classes vary only by COLUMN, so merge them once per column here
  // instead of once per cell inside the row loop.
  const headerClasses = columns.map((column) =>
    cn(
      TH_CLASSES,
      column.kind && HEADER_KIND_CLASSES[column.kind],
      column.srOnlyHeader && "w-[1%]",
      column.headerClassName,
    ),
  );
  const cellClasses = columns.map((column) =>
    cn(TD_CLASSES, column.kind && CELL_KIND_CLASSES[column.kind], column.className),
  );

  return (
    // The white card holding every table: rounded so the row accent stripes clip
    // with it; the last row drops its hairline so it doesn't double the card edge.
    <div className="overflow-hidden rounded-xl border border-foreground/10 bg-card shadow-xs [&_tbody_tr:last-child>td]:border-b-0">
      <table className={TABLE_CLASSES}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are static per render — the index is a stable identity
              <th key={index} scope="col" className={headerClasses[index]}>
                {column.srOnlyHeader ? (
                  <span className="sr-only">{column.header}</span>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className={rowClassName?.(row)}>
              {columns.map((column, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are static per render — the index is a stable identity
                <td key={index} className={cellClasses[index]}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Prev/Next share one recipe; the unavailable end renders as a <span> instead of
// a <Link> because `buttonVariants`' `disabled:` styles only bite on a <button>,
// and swapping the element (rather than dropping it) keeps the row from shifting.
const PAGER_STEP = buttonVariants({ variant: "outline", size: "sm" });

function PagerStep({ href, label }: { href: string | undefined; label: string }) {
  return href ? (
    <Link href={href} className={PAGER_STEP}>
      {label}
    </Link>
  ) : (
    <span aria-disabled="true" className={cn(PAGER_STEP, "pointer-events-none opacity-50")}>
      {label}
    </span>
  );
}

/**
 * The server-rendered pager: a range label plus prev/next links that set `?page=`
 * (plain <Link>s, so paging works without JS). Hrefs derive from the EFFECTIVE
 * page in `pagination`, never from the URL — a clamped page must not offer a
 * "Next" that doesn't exist.
 */
function Pager({ pagination, rowCount }: { pagination: ListPagination; rowCount: number }) {
  const { pathname, params } = pagination;
  const { page, pageSize, total } = pagination.result;
  // No chrome for an empty list. `rowCount` is checked too: COUNT and the row
  // query aren't in one transaction, so a concurrent delete can leave a total
  // with no rows — better no pager than "Showing 21–20 of 137".
  if (total === 0 || rowCount === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(from + rowCount - 1, total);
  const hasMorePages = total > pageSize;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-foreground/70">
        Showing {from}–{to} of {total}
      </p>
      {hasMorePages ? (
        <div className="flex items-center gap-2">
          <PagerStep
            href={page > 1 ? pageHref(pathname, params, page - 1, pageSize) : undefined}
            label="‹ Previous"
          />
          <PagerStep
            href={
              page < lastPage(total, pageSize)
                ? pageHref(pathname, params, page + 1, pageSize)
                : undefined
            }
            label="Next ›"
          />
        </div>
      ) : null}
    </nav>
  );
}

export function DataList<T>({
  rows,
  getRowKey,
  columns,
  rowClassName,
  actions,
  filterBar,
  hint,
  isFiltered,
  emptyState,
  noMatchState,
  pagination,
}: DataListProps<T>) {
  return (
    <PageBody>
      {hint ? <p className="text-foreground/70 text-sm">{hint}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
        {filterBar}
      </div>

      {rows.length === 0 ? (
        <p>{isFiltered ? noMatchState : emptyState}</p>
      ) : (
        <ListTable
          rows={rows}
          getRowKey={getRowKey}
          columns={columns}
          rowClassName={rowClassName}
        />
      )}

      {pagination ? <Pager pagination={pagination} rowCount={rows.length} /> : null}
    </PageBody>
  );
}
