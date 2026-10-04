import { type SQL, sql, TransactionRollbackError } from "drizzle-orm";
import { getDb } from "@/lib/db";

// The app's and Mastra's tables and indexes, whose statistics a plan check sets aside.
const PLANNED_RELATIONS = sql`
  SELECT c.oid, n.nspname, c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'mastra') AND c.relkind IN ('r', 'i')
`;

/**
 * The EXPLAIN plan of a store's real statement — the start page's "cheap by
 * shape" check (docs/home.md → Load protection). Sequential scans are off, so a
 * usable index must show, and the plan is made from the statement's SHAPE:
 * inside the (rolled-back) transaction every app and Mastra table's statistics
 * are cleared, as on a freshly migrated database (CI). Otherwise a long-lived
 * database's few, skewed rows can make "read another index, filter the user's
 * rows" look cheaper and the check would depend on whatever ran before.
 * Clearing `pg_statistic` needs a superuser, which the test databases are.
 *
 * `presorted`: for a statement whose ORDER BY an index is meant to serve, sorts
 * are off too, so only an index that delivers the order can win.
 */
export async function planOf(
  statement: SQL,
  { presorted = false }: { presorted?: boolean } = {},
): Promise<string> {
  let plan = "";
  try {
    await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_clear_relation_stats(r.nspname, r.relname) FROM (${PLANNED_RELATIONS}) r`,
      );
      await tx.execute(
        sql`DELETE FROM pg_statistic WHERE starelid IN (SELECT r.oid FROM (${PLANNED_RELATIONS}) r)`,
      );
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      if (presorted) {
        await tx.execute(sql`SET LOCAL enable_sort = off`);
        await tx.execute(sql`SET LOCAL enable_incremental_sort = off`);
      }
      const res = await tx.execute<{ "QUERY PLAN": unknown }>(
        sql`EXPLAIN (FORMAT JSON) ${statement}`,
      );
      plan = JSON.stringify(res.rows[0]?.["QUERY PLAN"]);
      // Nothing of this check may outlive it: the rollback restores the statistics.
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  return plan;
}

interface PlanNode {
  "Node Type": string;
  "Index Name"?: string;
  "Index Cond"?: string;
  Plans?: PlanNode[];
}

/** Every node of an EXPLAIN (FORMAT JSON) plan, depth first. */
export function planNodes(plan: string): PlanNode[] {
  const walk = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(walk)];
  return (JSON.parse(plan) as { Plan: PlanNode }[]).flatMap((root) => walk(root.Plan));
}

/** The index condition of the scan that reads `index`, or undefined when no scan does. */
export function indexCondOf(plan: string, index: string): string | undefined {
  return planNodes(plan).find((node) => node["Index Name"] === index)?.["Index Cond"];
}
