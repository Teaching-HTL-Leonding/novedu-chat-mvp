// Waits for the CI Postgres service container to accept connections, then
// creates the `mastra` schema Mastra's `PostgresStore` expects. Used by the e2e
// job in .github/workflows/qa.yml BEFORE Playwright boots the dev server.
//
// The `postgres:18` image creates the target database itself (`POSTGRES_DB`),
// and the app creates its own `novedu_*` tables at boot (instrumentation.ts) —
// this script only polls readiness and idempotently ensures the `mastra` schema
// exists ahead of time. See docs/testing.md (the @live-db CI section).
//
// Reads DATABASE_URL (a `postgresql://` URL — the CI container's is a
// password-auth string with a non-secret dummy password). Reuses the existing
// `pg` dependency — no extra tooling. Pure CI helper.

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("wait-and-create-db: DATABASE_URL is not set");
  process.exit(1);
}

const MAX_ATTEMPTS = 60;
const DELAY_MS = 2000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    break;
  } catch (err) {
    await client.end().catch(() => {});
    client = undefined;
    if (attempt === MAX_ATTEMPTS) {
      console.error(`wait-and-create-db: Postgres never became ready: ${err.message}`);
      process.exit(1);
    }
    console.log(`wait-and-create-db: Postgres not ready yet (attempt ${attempt}/${MAX_ATTEMPTS})…`);
    await sleep(DELAY_MS);
  }
}

try {
  await client.query("CREATE SCHEMA IF NOT EXISTS mastra");
  console.log("wait-and-create-db: database is ready, 'mastra' schema present");
} finally {
  await client.end();
}
