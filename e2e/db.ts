import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { buildPoolConfig } from "../lib/db/pool";

// The e2e suite's ONE database seam — plain `pg`, deliberately NOT the app's
// Drizzle store: Playwright's CommonJS test runner cannot load drizzle-orm's
// ESM-only build (the same constraint `lib/db/pool.ts` documents for itself).
// Every raw SQL statement issued through `query()` below writes/reads the same
// tables Drizzle owns (`lib/db/schema.ts`) and the same Mastra tables
// (`app/mastra/index.ts`) — keep the column names and shapes in sync with
// those two files by hand.
//
// Reuses `buildPoolConfig` from `lib/db/pool.ts` so the e2e helpers can never
// drift from the dev server's own parse/auth decision (password vs. passwordless
// Entra, picked from `DATABASE_URL` itself).

let pool: Pool | undefined;

/**
 * Returns the shared Postgres pool for this Playwright worker (one per worker
 * process, lazily created on first use). Loads `.env` exactly as Next does, so
 * the database and credentials can never drift from the dev server's.
 */
export function getPool(): Pool {
  if (!pool) {
    loadEnvConfig(process.cwd());
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("e2e: DATABASE_URL is not set — cannot reach the database");
    }
    pool = new Pool(buildPoolConfig(url));
  }
  return pool;
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
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}
