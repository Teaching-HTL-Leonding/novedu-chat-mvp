import type { ReactNode } from "react";
import { PageBody } from "@/components/page-main";
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
const TH_CLASSES = "border-foreground/25 border-b-2 px-3 py-2 text-left font-semibold";
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

export interface DataListProps<T> {
  rows: T[];
  getRowKey: (row: T) => string;
  columns: ListColumn<T>[];
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
}

/** The bare table — column recipes included, no page shell or toolbar. */
export function ListTable<T>({
  rows,
  getRowKey,
  columns,
}: {
  rows: T[];
  getRowKey: (row: T) => string;
  columns: ListColumn<T>[];
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
          <tr key={getRowKey(row)}>
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
  );
}

export function DataList<T>({
  rows,
  getRowKey,
  columns,
  actions,
  filterBar,
  hint,
  isFiltered,
  emptyState,
  noMatchState,
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
        <ListTable rows={rows} getRowKey={getRowKey} columns={columns} />
      )}

      {/* PAGINATION SEAM: a future server-rendered pager (prev/next <Link>s that
          set ?page=) goes here — one place, applies to every list. See
          docs/filtered-lists.md. */}
    </PageBody>
  );
}
