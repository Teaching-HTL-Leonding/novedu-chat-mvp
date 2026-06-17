import type { ReactNode } from "react";
import styles from "./list-page.module.css";

// A column-driven list table for "filtered list" pages (see
// `docs/filtered-lists.md`). This is a SERVER component: the rows arrive
// ALREADY filtered by the database (the page reads the URL search params and
// queries with a WHERE clause), so there is no client-side filtering. Column
// `render` functions stay server-side here — no Server→Client function boundary
// is crossed — and may return client leaf components (LocalTime, copy/delete
// buttons), which hydrate normally.

export interface ListColumn<T> {
  /** Header cell content. */
  header: ReactNode;
  /** Body cell content for one row (returns the cell content, not the <td>). */
  render: (row: T) => ReactNode;
  /** Optional class on the <td>. */
  className?: string;
  /** Optional class on the <th> (defaults to the actions-header width when srOnly). */
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
    <div className={styles.container}>
      {hint ? <p className={styles.hint}>{hint}</p> : null}

      <div className={styles.toolbar}>
        <div className={styles.actions}>{actions}</div>
        {filterBar}
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>{isFiltered ? noMatchState : emptyState}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are static per render — the index is a stable identity
                  key={index}
                  scope="col"
                  className={
                    column.headerClassName ??
                    (column.srOnlyHeader ? styles.actionsHeader : undefined)
                  }
                >
                  {column.srOnlyHeader ? (
                    <span className={styles.visuallyHidden}>{column.header}</span>
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
                  <td key={index} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* PAGINATION SEAM: a future server-rendered pager (prev/next <Link>s that
          set ?page=) goes here — one place, applies to every list. See
          docs/filtered-lists.md. */}
    </div>
  );
}
