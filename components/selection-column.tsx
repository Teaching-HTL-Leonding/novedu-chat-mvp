import type { ListColumn } from "@/components/data-list";
import { RowSelectCheckbox, SelectAllControls } from "@/components/list-selection";

// Server-safe builder (NOT "use client") for the leading row-selection column, so
// a list page opts into multi-delete with ONE entry in its `columns` array. Like a
// page's other columns it returns client leaf elements (the checkbox + the header
// controls) — the same Server→Client leaf pattern DataList already relies on (see
// docs/filtered-lists.md). `getRowKey` returns the SELECTION key (what the bulk
// delete action expects — a file name, a tutor code), which must match the
// `allIds` given to <SelectionProvider>; `rowLabel` only sharpens the checkbox's
// accessible name.
// `ListColumn<T, never>` — never a sortable column, and `never` is assignable to
// whatever sort-key union the page pins its `columns` array to.
export function selectionColumn<T>(
  getRowKey: (row: T) => string,
  rowLabel?: (row: T) => string,
): ListColumn<T, never> {
  return {
    header: <SelectAllControls />,
    headerClassName: "w-[1%]",
    className: "w-[1%] whitespace-nowrap text-center",
    render: (row) => <RowSelectCheckbox id={getRowKey(row)} label={rowLabel?.(row)} />,
  };
}
