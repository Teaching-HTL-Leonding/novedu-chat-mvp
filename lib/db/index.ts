import { drizzle, type NodeMsSqlDatabase } from "drizzle-orm/node-mssql";
import { buildMssqlConnectionConfig } from "@/lib/azure-credential";
import * as schema from "./schema";

export type Db = NodeMsSqlDatabase<typeof schema>;

// The handle a `db.transaction(cb)` callback receives. `DbExecutor` is "either the
// root handle or a transaction", so a store helper (e.g. closing one file, deleting
// one tutor code's rows) can run standalone OR be batched into a single transaction
// by a bulk caller — the SAME code path either way.
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbExecutor = Db | Transaction;

// Drizzle handle for the app-owned `novedu_*` tables, connecting to the SAME
// Azure SQL database as Mastra but through its OWN pool — Mastra manages its
// pool's lifecycle internally (app/mastra/index.ts) and we don't reach into it.
//
// Connection config mirrors the Mastra store: `buildMssqlConnectionConfig`
// parses `MSSQL_CONNECTION_STRING` and picks SQL user/password auth or Entra ID
// from the string itself (the single seam in lib/azure-credential.ts).
//
// Drizzle's AutoPool connects lazily on first query and reuses the pool after,
// so building the handle is cheap and never throws on a bad/missing DB.
function buildDb(connectionString: string): Db {
  const config = buildMssqlConnectionConfig(connectionString);
  // The driver accepts an mssql `config` object for `connection` (it wraps it
  // in its lazily-connecting AutoPool), but the beta's typings only admit a
  // string — hence the cast. Revisit when drizzle-orm v1 leaves beta.
  return drizzle({ connection: config as unknown as string, schema });
}

// One pool across Next.js HMR reloads in dev (same pattern as the Mastra store).
const globalForDb = globalThis as unknown as { noveduDb?: Db };

export function getDb(): Db {
  if (!globalForDb.noveduDb) {
    const connectionString = process.env.MSSQL_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("MSSQL_CONNECTION_STRING is not set — tutor-code storage is unavailable");
    }
    globalForDb.noveduDb = buildDb(connectionString);
  }
  return globalForDb.noveduDb;
}
