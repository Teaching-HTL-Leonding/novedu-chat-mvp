import { type SQL, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

/**
 * The EXPLAIN plan of a store's real statement, with sequential scans off so a
 * usable index must show — the start page's "cheap by shape" check
 * (docs/home.md → Load protection).
 */
export async function planOf(statement: SQL): Promise<string> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const res = await tx.execute<{ "QUERY PLAN": unknown }>(
      sql`EXPLAIN (FORMAT JSON) ${statement}`,
    );
    return JSON.stringify(res.rows[0]?.["QUERY PLAN"]);
  });
}
