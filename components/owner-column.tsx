import type { ListColumn } from "@/components/data-list";

/** What a list row must carry to render the shared Owner column. */
export interface OwnedRow {
  /** The owner's Entra oid (the row's `created_by`). */
  createdBy: string;
  /** Its `novedu_users` resolution; `null` when that teacher has no row yet. */
  ownerName: string | null;
}

// Server-safe builder (NOT "use client") for the shared OWNER column, so the three
// item lists opt in with ONE entry in their `columns` array — the same shape as
// `selectionColumn`. The column pairs with the `OwnerFilter` dropdown and with the
// store's `owner` sort key, which orders by the SAME coalesced label the cell shows
// (see docs/filtered-lists.md).
//
// The oid is the fallback label for a teacher who has never signed in through the
// web app, and the tooltip always carries it — two teachers can share a display name.
//
// That fallback is also why the column is width-capped and ellipsised, the same
// recipe the codes list's Note column uses: a raw oid is a 36-character GUID that
// would otherwise widen the whole table by ~100px and push the narrower viewports
// into a horizontal scroll. The full value stays reachable in the tooltip.
export function ownerColumn<T extends OwnedRow>(): ListColumn<T, "owner"> {
  return {
    header: "Owner",
    sortKey: "owner",
    className: "max-w-48 overflow-hidden text-ellipsis whitespace-nowrap",
    render: (row) => <span title={row.createdBy}>{row.ownerName ?? row.createdBy}</span>,
  };
}
