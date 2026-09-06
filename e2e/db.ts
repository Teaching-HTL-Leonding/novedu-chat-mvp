import { loadEnvConfig } from "@next/env";
import { closePool as closeAppPool, getPool as getAppPool } from "../lib/db/pool";

// The e2e suite's ONE database seam — plain `pg` statements, deliberately NOT
// the app's Drizzle store, so the fixtures stay independent of the query layer
// under test. Every raw SQL statement issued through `query()` below writes/reads
// the same tables Drizzle owns (`lib/db/schema.ts`) and the same Mastra tables
// (`app/mastra/index.ts`) — keep the column names and shapes in sync with those
// two files by hand.
//
// The pool itself IS the app's: `getPool()` from `lib/db/pool.ts` (one per
// Playwright worker process, cached on globalThis, with the idle-client error
// listener), so the e2e helpers can never drift from the dev server's own
// parse/auth decision (password vs. passwordless Entra, picked from
// `DATABASE_URL` itself).

let envLoaded = false;

/**
 * Returns the shared Postgres pool for this Playwright worker (lazily created on
 * first use). Loads `.env` exactly as Next does, so the database and credentials
 * can never drift from the dev server's.
 */
export function getPool(): ReturnType<typeof getAppPool> {
  if (!envLoaded) {
    loadEnvConfig(process.cwd());
    envLoaded = true;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("e2e: DATABASE_URL is not set — cannot reach the database");
  }
  return getAppPool();
}

/** Runs a parameterised query against the shared pool and returns its rows. */
export async function query<T extends object>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await getPool().query<T & { [column: string]: unknown }>(
    text,
    params as unknown[],
  );
  return result.rows;
}

/** Closes the shared pool — call in a suite-level `afterAll` if one is needed. */
export async function closePool(): Promise<void> {
  await closeAppPool();
}
