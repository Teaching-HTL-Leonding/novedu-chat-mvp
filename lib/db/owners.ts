import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import type { OwnerOption } from "@/lib/db/owner-filter";
import { users } from "@/lib/db/schema";

// The options behind a list's OWNER dropdown (see `docs/filtered-lists.md`): the
// DISTINCT `created_by` values of one list table, resolved to display names through
// `novedu_users` — the same by-value LEFT JOIN with an oid fallback that
// `lib/report-store.ts` and `lib/code-stats-store.ts` use for a student id. Every
// list runs the identical query, so it lives here once, next to the COUNT half in
// `lib/db/count.ts`.
//
// SERVER-ONLY: touches the database. The URL grammar and the option type are the
// DB-free `lib/db/owner-filter.ts`, which the client filter bar imports.

/**
 * A list table's owner join: `novedu_users` BY VALUE on its `created_by`. The join
 * is DISPLAY-ONLY — no list condition may reach into `users`, or the joinless COUNT
 * would stop describing the same set as the rows.
 */
export function ownerJoin(createdBy: AnyPgColumn): SQL {
  return eq(users.userId, createdBy);
}

/**
 * The owner's label as SQL: the display name, or the raw oid for a teacher who has
 * never signed in through the web app. Declared once because it does double duty —
 * it is what the dropdown shows AND what the `owner` sort key orders by, so the
 * column always sorts by exactly what it displays. Ordering by the coalesced label
 * (rather than by `display_name`) is also what keeps an oid-only owner inside the
 * alphabet instead of leading the list as a NULL.
 */
export function ownerLabel(createdBy: AnyPgColumn): SQL<string> {
  return sql<string>`COALESCE(${users.displayName}, ${createdBy})`;
}

/**
 * The distinct owners of a list's rows, alphabetically by what the dropdown shows.
 *
 * `conditions` must be the list's BASE conditions only (the active-version /
 * known-module guard), never the user's current search or module filter: the option
 * set has to stay stable, or the owner a teacher just picked could vanish from the
 * control that picked them. The caller supplies the signed-in teacher's own option —
 * they may own nothing yet, and their entry is the default.
 *
 * Never throws: an unreachable database yields an empty list, so the page still
 * renders (with just the "me" and "all owners" entries) instead of failing.
 */
export async function listOwners(
  table: AnyPgTable,
  createdBy: AnyPgColumn,
  conditions: SQL[],
): Promise<OwnerOption[]> {
  // Postgres requires every ORDER BY term of a SELECT DISTINCT to appear in the
  // select list, which is why the ORDER BY repeats this exact expression rather
  // than ordering by `users.display_name`.
  const label = ownerLabel(createdBy);
  try {
    const rows = await getDb()
      .selectDistinct({ userId: createdBy, label })
      .from(table)
      .leftJoin(users, ownerJoin(createdBy))
      .where(and(...conditions))
      .orderBy(asc(label));
    return rows.map((row) => ({ userId: String(row.userId), label: String(row.label) }));
  } catch (error) {
    console.error("db/owners: listing owners failed", error);
    return [];
  }
}
