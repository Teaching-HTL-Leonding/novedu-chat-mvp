import { drizzle, type NodeMsSqlDatabase } from "drizzle-orm/node-mssql";
import sql from "mssql";
import { buildDataStoreCredential } from "@/lib/azure-credential";
import * as schema from "./schema";

export type Db = NodeMsSqlDatabase<typeof schema>;

// Drizzle handle for the app-owned `novedu_*` tables, connecting to the SAME
// Azure SQL database as Mastra but through its OWN pool — Mastra manages its
// pool's lifecycle internally (app/mastra/index.ts) and we don't reach into it.
//
// Connection config mirrors the Mastra store: parse `MSSQL_CONNECTION_STRING`
// for host/database/encrypt, then replace the auth with Entra ID via tedious's
// `token-credential` (node-mssql's parser doesn't understand the ADO.NET
// `Authentication=` keyword, and the token credential refreshes tokens per
// pooled connection). The credential is the shared data-store chain — see the
// invariant in lib/azure-credential.ts.
//
// Drizzle's AutoPool connects lazily on first query and reuses the pool after,
// so building the handle is cheap and never throws on a bad/missing DB.
function buildDb(connectionString: string): Db {
  const config = sql.ConnectionPool.parseConnectionString(connectionString);
  config.authentication = {
    type: "token-credential",
    options: { credential: buildDataStoreCredential() },
  };
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
