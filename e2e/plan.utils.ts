import { type SQL, sql, TransactionRollbackError } from "drizzle-orm";
import { getDb } from "@/lib/db";

// The app's and Mastra's tables and indexes whose statistics a plan check sets
// aside — every one the connected role may maintain (its own, as the owner).
const PLANNED_RELATIONS = sql`
  SELECT n.nspname, c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_index i ON i.indexrelid = c.oid
  WHERE n.nspname IN ('public', 'mastra') AND c.relkind IN ('r', 'i')
    AND has_table_privilege(coalesce(i.indrelid, c.oid), 'MAINTAIN')
`;

// Their tables' column statistics (`pg_stats` shows only what the role may read).
const PLANNED_COLUMNS = sql`
  SELECT s.schemaname, s.tablename, s.attname, s.inherited FROM pg_stats s
  JOIN pg_namespace n ON n.nspname = s.schemaname
  JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = s.tablename AND c.relkind = 'r'
  WHERE s.schemaname IN ('public', 'mastra') AND has_table_privilege(c.oid, 'MAINTAIN')
`;

/**
 * The EXPLAIN plan of a store's real statement — the start page's "cheap by
 * shape" check (docs/home.md → Load protection). Sequential scans are off, so a
 * usable index must show, and the plan is made from the statement's SHAPE:
 * inside the (rolled-back) transaction every app and Mastra table's statistics
 * are cleared, as on a freshly migrated database (CI). Otherwise a long-lived
 * database's few, skewed rows can make "read another index, filter the user's
 * rows" look cheaper and the check would depend on whatever ran before.
 * Clearing needs the MAINTAIN privilege, which the tables' owner holds — the
 * stage's app role, or the CI container's superuser.
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
        sql`SELECT pg_clear_attribute_stats(s.schemaname, s.tablename, s.attname, s.inherited)
            FROM (${PLANNED_COLUMNS}) s`,
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
