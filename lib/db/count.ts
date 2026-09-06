import { and, type SQL, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";

// The `COUNT(*)` half of a paginated list (see `docs/filtered-lists.md`). Every
// list store runs the exact same count, so it lives here once: the page query and
// this must be given the SAME `conditions` array (and the same joins), or a page's
// total would describe a different set than its rows.
//
// SERVER-ONLY: touches the database. The pure paging math is `lib/db/paging.ts`,
// which stays DB-free because components import from it.

/**
 * Counts the rows a filtered list matches. `joins` are LEFT JOINs, needed when a
 * condition reaches into another table (the reports inbox filters on the reporter's
 * display name and the code's creator). Join on primary keys only — a join that can
 * multiply rows would inflate the count.
 *
 * Throws on a database error, like the row query it accompanies: the caller's
 * existing try/catch is what turns an unreachable database into `undefined`.
 */
export async function countRows(
  table: AnyPgTable,
  conditions: SQL[],
  joins: { table: AnyPgTable; on: SQL }[] = [],
): Promise<number> {
  // `$dynamic()` so the joins can be applied in a loop. Only `n` is ever read, so
  // the row-type erasure it causes costs nothing here. `mapWith(Number)` converts
  // `COUNT(*)`, which node-postgres returns as a string (it does that for every
  // bigint-typed column).
  let query = getDb()
    .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(table)
    .$dynamic();
  for (const join of joins) query = query.leftJoin(join.table, join.on);
  const [row] = await query.where(and(...conditions));
  return row?.n ?? 0;
}
