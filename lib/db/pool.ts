import { Pool, type PoolConfig } from "pg";
import { buildDataStoreCredential } from "@/lib/azure-credential";

// The ONE connection seam to the app's Postgres database: every consumer —
// Drizzle (lib/db/index.ts), the Mastra store (app/mastra/index.ts) and the e2e
// helper — takes the SAME pool from `getPool()`, so the parse/auth decision can
// never drift between them.
//
// This module deliberately imports NOTHING but `pg` and the credential builder:
// no drizzle, nothing from `app/**`. Playwright's CommonJS test runner loads
// `buildPoolConfig` directly, and drizzle's ESM-only build would break that.
//
// SERVER-ONLY: may build Azure credentials. Never import from client components.

/** Entra scope for Azure Database for PostgreSQL Flexible Server. */
const POSTGRES_TOKEN_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

/**
 * Parses `DATABASE_URL` into a node-postgres pool config and picks the auth mode
 * FROM THE URL ITSELF:
 *
 *  1. **Password auth** — the URL carries a password (`postgresql://user:pw@host/db`).
 *     Dev/test only (the CI container, a machine without `az login`).
 *  2. **Microsoft Entra ID (passwordless)** — no password in the URL. `password`
 *     becomes an async callback returning an Entra access token; node-postgres
 *     calls it for every NEW physical connection, so tokens refresh by themselves.
 *     The credential is built ONCE here and reused by the callback (the
 *     `@azure/identity` chain caches tokens internally). This is what production
 *     uses (Managed Identity) and what local dev uses (`az login`).
 *
 * The URL is parsed by hand and `connectionString` is NEVER passed to the pool:
 * node-postgres re-parses a `connectionString` and lets it override the explicit
 * fields, which would silently discard the token callback.
 */
export function buildPoolConfig(url: string): PoolConfig {
  const parsed = new URL(url);
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const sslmode = parsed.searchParams.get("sslmode");

  const config: PoolConfig = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    // Locally the Postgres role is the developer's Entra UPN, which the URL
    // carries percent-encoded (`rainer%40example.com`); `URL.username` keeps the
    // encoding, so decode it here.
    user: decodeURIComponent(parsed.username),
    // Bound the pool: dev, prod and the Playwright workers share one small
    // server (`max_connections = 50`).
    max: 10,
    idleTimeoutMillis: 30_000,
    // Bounds every statement: the app's largest writes —
    // Mastra messages carrying base64 photo attachments — must not be cut off,
    // but a runaway statement must still fail loudly.
    statement_timeout: 60_000,
    // Pin the session timezone so `now()` and `date_trunc` bucket in UTC
    // regardless of the server default (the usage dashboard depends on it).
    options: "-c TimeZone=UTC",
    application_name: "novedu",
  };

  if (password) {
    config.password = password;
  } else {
    const credential = buildDataStoreCredential();
    config.password = async () => {
      const accessToken = await credential.getToken(POSTGRES_TOKEN_SCOPE);
      if (!accessToken) throw new Error("Could not acquire an Entra token for the database");
      return accessToken.token;
    };
  }

  // Azure requires TLS; a local container URL without `sslmode` stays plain TCP.
  if (sslmode === "require" || sslmode === "verify-full") {
    config.ssl = { rejectUnauthorized: true };
  }

  return config;
}

// One pool per process, cached on globalThis so Next.js HMR reloads in dev reuse
// it instead of leaking a new pool per reload. In production the module is
// evaluated once and this is a plain no-op cache.
const globalForPool = globalThis as unknown as { noveduPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.noveduPool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set — database storage is unavailable");
    }
    const pool = new Pool(buildPoolConfig(url));
    // An error on an IDLE pooled client (server restart, network drop, an Azure
    // maintenance failover) is emitted on the pool. Without a listener Node
    // treats it as an unhandled 'error' event and kills the process — the pool
    // discards the broken client and reconnects on the next checkout anyway.
    pool.on("error", (err) => {
      console.error("db: idle client error", err);
    });
    globalForPool.noveduPool = pool;
  }
  return globalForPool.noveduPool;
}

/**
 * The database server's hostname, for the /health dashboard's DNS probe.
 * Returns null when `DATABASE_URL` is unset or unparseable.
 */
export function databaseHost(url = process.env.DATABASE_URL): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}
