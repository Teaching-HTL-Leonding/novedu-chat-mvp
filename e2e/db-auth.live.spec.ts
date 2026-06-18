import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import sql from "mssql";
import { buildMssqlConnectionConfig } from "../lib/azure-credential";

// @live: opens REAL Azure SQL connections — one per auth mode — to prove the
// `buildMssqlConnectionConfig` seam (lib/azure-credential.ts) authenticates
// end-to-end under BOTH supported modes: passwordless Microsoft Entra ID and
// classic SQL user/password. Excluded from CI by `test:e2e:ci`
// (`--grep-invert @live`); the secret-bearing SQL-auth string lives only in a
// local `.env` (provisioning + how-to-run live in docs/testing.md).
//
// Each test builds its pool through the REAL seam (not a hand-rolled config),
// asserts the chosen auth MODE, then runs a query that reports WHICH principal
// actually authenticated (`SUSER_SNAME()`) — so a misconfigured env can't
// silently make the two paths collapse into one.

// Load `.env` into the Playwright runner's process (the dev server and the other
// DB-backed e2e helpers do the same) so the connection strings are visible here.
loadEnvConfig(process.cwd());

type Probe = {
  config: ReturnType<typeof buildMssqlConnectionConfig>;
  who: string;
  db: string;
};

// Build a pool via the real seam, run a one-row identity query, always close.
async function probe(connectionString: string): Promise<Probe> {
  const config = buildMssqlConnectionConfig(connectionString);
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    const result = await pool.request().query("SELECT SUSER_SNAME() AS who, DB_NAME() AS db");
    const row = result.recordset[0];
    return { config, who: row.who as string, db: row.db as string };
  } finally {
    await pool.close();
  }
}

test.describe("Azure SQL auth modes", () => {
  test("a passwordless connection string authenticates via Entra ID", {
    tag: "@live",
  }, async () => {
    const connectionString = process.env.MSSQL_CONNECTION_STRING;
    test.skip(!connectionString, "MSSQL_CONNECTION_STRING is not set");

    const { config, who, db } = await probe(connectionString as string);

    // The seam chose the Entra path: a token credential, no SQL user/password.
    expect(config.authentication?.type).toBe("token-credential");
    expect(config.user).toBeUndefined();
    // It really connected — the exact principal varies by environment (the
    // `az login` user locally, a Managed Identity on Azure), so just require one.
    expect(who).toBeTruthy();
    expect(db).toBeTruthy();
  });

  test("a User ID/Password connection string authenticates as that SQL login", {
    tag: "@live",
  }, async () => {
    const connectionString = process.env.MSSQL_SQLAUTH_CONNECTION_STRING;
    // By design this test PASSES by skipping when the SQL-auth string is absent,
    // so the suite stays green for anyone who has not provisioned a SQL login.
    test.skip(
      !connectionString,
      "MSSQL_SQLAUTH_CONNECTION_STRING is not set — provision a SQL login (see docs/testing.md)",
    );

    const { config, who } = await probe(connectionString as string);

    // The seam left the parsed SQL credentials untouched (no token credential),
    // so tedious does a classic SQL Server login...
    expect(config.authentication).toBeUndefined();
    expect(config.user).toBeTruthy();
    // ...and it authenticated as exactly that login — proving it did NOT fall
    // through to Entra.
    expect(who).toBe(config.user);
  });
});
