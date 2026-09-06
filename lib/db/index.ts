import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getPool } from "@/lib/db/pool";

export type Db = NodePgDatabase;

// The handle a `db.transaction(cb)` callback receives. `DbExecutor` is "either the
// root handle or a transaction", so a store helper (e.g. closing one file, deleting
// one tutor code's rows) can run standalone OR be batched into a single transaction
// by a bulk caller — the SAME code path either way.
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbExecutor = Db | Transaction;

// Drizzle handle for the app-owned `novedu_*` tables. It runs on the SAME pool
// as the Mastra store (`getPool()` in lib/db/pool.ts) — one pool per process, and
// one place that decides how the app authenticates (password or Entra token).
//
// No `schema`/`relations` is registered: every store builds its statements from
// the table objects in ./schema directly (`db.select().from(codes)`), and the
// relational `db.query.*` API — the only thing that needs the registration — is
// not used anywhere. The by-value join model (docs/codes.md) has no relations to
// declare.
//
// node-postgres connects lazily on first query, so building the handle is cheap
// and never throws on an unreachable database. One handle across Next.js HMR
// reloads in dev (the pool underneath is cached the same way).
const globalForDb = globalThis as unknown as { noveduDb?: Db };

export function getDb(): Db {
  if (!globalForDb.noveduDb) {
    globalForDb.noveduDb = drizzle({ client: getPool() });
  }
  return globalForDb.noveduDb;
}
