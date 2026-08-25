import type { ListColumn } from "@/components/data-list";

/** What a list row must carry to render the shared Student column. */
export interface StudentRow {
  /** The student's Entra oid. */
  userId: string;
  /** Its `novedu_users` resolution; `null` when that student has no row yet. */
  displayName: string | null;
}

// Server-safe builder (NOT "use client") for the shared STUDENT column, so a
// per-code teacher list opts in with ONE entry in its `columns` array — the same
// shape as `ownerColumn`. Used by the writing savers list and the coding module's
// issued-keys list, which must keep showing a student identically.
//
// The oid is the fallback label for a student who has no `novedu_users` row yet, and
// the tooltip always carries it — two students can share a display name.
//
// That fallback is also why the column is width-capped, monospaced and ellipsised:
// a raw oid is a 36-character GUID that would otherwise widen the whole table. The
// full value stays reachable in the tooltip.
//
// `header` overrides the default label for a list whose rows are not necessarily
// students: the coding issued-keys list passes "User", because a teacher who mints
// their own key to test the endpoint legitimately appears in it. The CELL recipe is
// the shared part and never varies.
export function studentColumn<T extends StudentRow>(header = "Student"): ListColumn<T> {
  return {
    header,
    className: "max-w-96 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs",
    render: (row) => <span title={row.userId}>{row.displayName ?? row.userId}</span>,
  };
}
