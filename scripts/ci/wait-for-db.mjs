// Waits for the CI Postgres service container to accept connections. Used by the
// e2e job in .github/workflows/qa.yml BEFORE Playwright boots the dev server.
//
// That is the whole job: the `postgres:18` image creates the target database
// itself (`POSTGRES_DB`), and the app creates the `mastra` schema, Mastra's
// `mastra_*` tables and its own `novedu_*` tables at boot (instrumentation.ts →
// lib/db/migrate.ts + app/mastra/index.ts). See docs/testing.md (the @live-db CI
// section).
//
// Reads DATABASE_URL (a `postgresql://` URL — the CI container's is a
// password-auth string with a non-secret dummy password). Reuses the existing
// `pg` dependency — no extra tooling. Pure CI helper.

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("wait-for-db: DATABASE_URL is not set");
  process.exit(1);
}

const MAX_ATTEMPTS = 60;
const DELAY_MS = 2000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    console.log("wait-for-db: database is ready");
    break;
  } catch (err) {
    if (attempt === MAX_ATTEMPTS) {
      console.error(`wait-for-db: Postgres never became ready: ${err.message}`);
      process.exit(1);
    }
    console.log(`wait-for-db: Postgres not ready yet (attempt ${attempt}/${MAX_ATTEMPTS})…`);
    await sleep(DELAY_MS);
  } finally {
    await client.end().catch(() => {});
  }
}
