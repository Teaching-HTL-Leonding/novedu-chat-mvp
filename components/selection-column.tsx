import type { ListColumn } from "@/components/data-list";
import { RowSelectCheckbox, SelectAllControls } from "@/components/list-selection";
import styles from "./list-selection.module.css";

// Server-safe builder (NOT "use client") for the leading row-selection column, so
// a list page opts into multi-delete with ONE entry in its `columns` array. Like a
// page's other columns it returns client leaf elements (the checkbox + the header
// controls) — the same Server→Client leaf pattern DataList already relies on (see
// docs/filtered-lists.md). `getRowKey` returns the SELECTION key (what the bulk
// delete action expects — a file name, a tutor code), which must match the
// `allIds` given to <SelectionProvider>; `rowLabel` only sharpens the checkbox's
// accessible name.
export function selectionColumn<T>(
  getRowKey: (row: T) => string,
  rowLabel?: (row: T) => string,
): ListColumn<T> {
  return {
    header: <SelectAllControls />,
    headerClassName: styles.selectHeaderCell,
    className: styles.selectCell,
    render: (row) => <RowSelectCheckbox id={getRowKey(row)} label={rowLabel?.(row)} />,
  };
}
