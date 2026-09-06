// The ONE reader of "how many rows did this statement touch" for the app-owned
// `novedu_*` tables. node-postgres reports it as `rowCount` (`number | null` —
// null for statements without a count); a conditional UPDATE/DELETE uses it to
// tell "I changed the row" (>= 1) from "there was nothing to change" (0).

/** Rows affected by a drizzle `update`/`delete` result; `null`/absent reads as 0. */
export function affectedRows(result: { rowCount?: number | null }): number {
  return result.rowCount ?? 0;
}
