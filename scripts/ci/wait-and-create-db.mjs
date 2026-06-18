// Waits for the CI SQL Server container to accept connections, then creates the
// app's database. Used by the e2e job in .github/workflows/qa.yml BEFORE Playwright
// boots the dev server — the app migrates *tables* on startup but never creates the
// *database* itself (Drizzle migrates an existing DB), so the target catalog must
// exist first. See docs/testing.md (the @live-db CI section).
//
// Reads MSSQL_CONNECTION_STRING (a SQL-auth container string, e.g.
//   Server=tcp:localhost,1433;Initial Catalog=noveduTest;Encrypt=False;User ID=sa;Password=...;
// ). It connects to `master` (the target DB does not exist yet) and creates it.
// Reuses the existing `mssql` dependency — no extra tooling. Pure CI helper.

import sql from "mssql";

const connectionString = process.env.MSSQL_CONNECTION_STRING;
if (!connectionString) {
  console.error("wait-and-create-db: MSSQL_CONNECTION_STRING is not set");
  process.exit(1);
}

const config = sql.ConnectionPool.parseConnectionString(connectionString);
const targetDb = config.database;
if (!targetDb || !/^[A-Za-z0-9_]+$/.test(targetDb)) {
  console.error(`wait-and-create-db: refusing unusual database name: ${JSON.stringify(targetDb)}`);
  process.exit(1);
}

// Connect to `master` (the target DB does not exist yet) with a short per-attempt
// timeout so the readiness poll stays responsive.
config.database = "master";
config.connectionTimeout = 5000;

const MAX_ATTEMPTS = 60;
const DELAY_MS = 2000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pool;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    pool = await new sql.ConnectionPool(config).connect();
    break;
  } catch (err) {
    if (attempt === MAX_ATTEMPTS) {
      console.error(`wait-and-create-db: SQL Server never became ready: ${err.message}`);
      process.exit(1);
    }
    console.log(`wait-and-create-db: SQL not ready yet (attempt ${attempt}/${MAX_ATTEMPTS})…`);
    await sleep(DELAY_MS);
  }
}

try {
  // targetDb is validated above as a plain identifier; safe to interpolate.
  await pool.request().query(`IF DB_ID('${targetDb}') IS NULL CREATE DATABASE [${targetDb}]`);
  console.log(`wait-and-create-db: database '${targetDb}' is ready`);
} finally {
  await pool.close();
}
