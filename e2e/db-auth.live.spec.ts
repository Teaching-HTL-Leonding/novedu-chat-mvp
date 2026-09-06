import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { buildPoolConfig } from "../lib/db/pool";

// @live-db: opens a REAL Postgres connection to prove the `buildPoolConfig` seam
// (lib/db/pool.ts) authenticates via passwordless Microsoft Entra ID — the
// function-valued `password` callback path. The CLASSIC password path needs no
// dedicated test here: every other `@live-db` spec already connects through it
// (CI's `DATABASE_URL` carries the container's dummy password), so a broken
// password branch would already fail the whole suite. This test SKIPS whenever
// `DATABASE_URL` is unset or carries a literal password (the CI/local-container
// shape) — it only runs where the URL is passwordless (real Azure Database for
// PostgreSQL + `az login`, or a Managed Identity in production).
//
// Load `.env` into the Playwright runner's process (the dev server and the other
// DB-backed e2e helpers do the same) so `DATABASE_URL` is visible here.
loadEnvConfig(process.cwd());

test("a passwordless DATABASE_URL authenticates via Entra ID", {
  tag: ["@live", "@live-db"],
}, async () => {
  const url = process.env.DATABASE_URL;
  test.skip(!url, "DATABASE_URL is not set");

  const config = buildPoolConfig(url as string);
  test.skip(
    typeof config.password !== "function",
    "DATABASE_URL carries a password — Entra path not in use",
  );

  const pool = new Pool(config);
  try {
    const result = await pool.query<{ who: string; db: string }>(
      "SELECT current_user AS who, current_database() AS db",
    );
    const row = result.rows[0];

    expect(row?.who).toBe(decodeURIComponent(new URL(url as string).username));
    expect(row?.db).toBeTruthy();
  } finally {
    await pool.end();
  }
});
