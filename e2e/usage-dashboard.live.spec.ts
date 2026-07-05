import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import sql from "mssql";
import { buildMssqlConnectionConfig } from "../lib/azure-credential";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { mintCode } from "./code.utils";

// A REAL end-to-end check that the dashboard's aggregate queries run against the
// live schema and render. It seeds `novedu_usage_by_code` rows for the current UTC
// hour (so the default 24h window includes them) via the plain `mssql` driver — the
// Playwright CJS runner can't load Drizzle's ESM `lib/db`, same as the other @live
// specs — then loads `/usage` as a teacher and asserts the charts/table/KPIs
// reflect the seed. Needs the DB but NOT the LLM, so it is `@live-db` and runs in CI
// against the ephemeral container. Cleans up its own rows in `finally`. See
// docs/dashboard.md + docs/testing.md.

test.use({ storageState: TEACHER_STORAGE_STATE });

// Seed generous per-code totals so the code lands in the pie's top 9 even when the
// DB already holds other codes (locally; in CI the container is clean).
const TOKENS_NEW = 9_000_000;
const TOKENS_CACHED = 3_000_000;
const TOKENS_OUTPUT = 2_000_000;
const QUIZ_ANSWERS = 7;

test.setTimeout(60_000);

test("the usage dashboard renders seeded token metrics", { tag: ["@live", "@live-db"] }, async ({
  page,
}) => {
  loadEnvConfig(process.cwd());
  const connectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!connectionString) throw new Error("e2e: MSSQL_CONNECTION_STRING is not set");
  const pool = await new sql.ConnectionPool(buildMssqlConnectionConfig(connectionString)).connect();

  // A unique note so it can be found unambiguously in the code-pie legend.
  const note = `E2E Usage ${Date.now()}`;
  const quizCode = await mintCode({
    module: "quiz",
    note,
    file: "https://example.com/api/files/q",
  });
  const tutorCode = await mintCode({ module: "tutor", note: `${note} tutor` });

  // A unique model id so the model-pie legend can be asserted unambiguously; the
  // provider/model columns are seeded like the LLM recorder writes them.
  const model = `e2e-model-${Date.now()}`;
  const seedUsage = (code: string, module: string, quizAnswers: number) =>
    pool
      .request()
      .input("code", sql.VarChar(32), code)
      .input("module", sql.VarChar(16), module)
      .input("model", sql.NVarChar(256), model)
      .input("inNew", sql.BigInt, TOKENS_NEW)
      .input("inCached", sql.BigInt, TOKENS_CACHED)
      .input("out", sql.BigInt, TOKENS_OUTPUT)
      .input("quiz", sql.Int, quizAnswers)
      .query(
        `INSERT INTO novedu_usage_by_code
             (code, hour, module, provider, model, input_tokens_new, input_tokens_cached,
              output_tokens, tool_calls, user_messages, quiz_answers, writing_saves)
           VALUES
             (@code, DATEADD(hour, DATEDIFF(hour, 0, SYSUTCDATETIME()), 0), @module,
              'SCCH', @model, @inNew, @inCached, @out, 0, 0, @quiz, 0)`,
      );

  try {
    await seedUsage(quizCode, "quiz", QUIZ_ANSWERS);
    await seedUsage(tutorCode, "tutor", 0);

    await page.goto("/usage");

    // All four sections render their headings.
    await expect(page.getByRole("heading", { name: "Token usage over time" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tokens by category" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tokens by code" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tokens by model" })).toBeVisible();

    // The time-series query ran and the shared table rendered.
    await expect(page.getByRole("columnheader", { name: "Total" })).toBeVisible();

    // The token AGGREGATE actually summed: both seeds land in the same UTC hour
    // bucket, so that bucket's cells (New input 18M, Total 28M, …) dwarf everything
    // else. Assert the largest numeric cell is at least the combined seed — this
    // catches a zeroed/swapped SUM or a broken bucket GROUP BY that renders 0s.
    // Robust on a busy local DB (other codes only ADD) and across an hour boundary
    // (the seed row stays inside the 24h window, just in an earlier bucket).
    const combinedSeed = (TOKENS_NEW + TOKENS_CACHED + TOKENS_OUTPUT) * 2;
    const cellTexts = await page.getByRole("cell").allInnerTexts();
    const maxCell = Math.max(0, ...cellTexts.map((t) => Number(t.replace(/[^0-9]/g, "")) || 0));
    expect(maxCell).toBeGreaterThanOrEqual(combinedSeed);

    // The breakdown query ran: the seeded code shows in the code-pie legend.
    await expect(page.getByText(note, { exact: true })).toBeVisible();

    // The by-model query ran: the seeded model id shows in the model-pie legend.
    await expect(page.getByText(model, { exact: true })).toBeVisible();

    // The KPI query ran and is windowed: quiz answers ≥ what we seeded (== in CI's
    // clean DB; ≥ locally where other codes may add to the bucket).
    const quizTile = page.getByTestId("usage-kpi-quiz");
    await expect(quizTile).toBeVisible();
    const quizValue = Number((await quizTile.innerText()).replace(/[^0-9]/g, ""));
    expect(quizValue).toBeGreaterThanOrEqual(QUIZ_ANSWERS);

    await expect(page.getByTestId("usage-kpi-chats")).toBeVisible();
  } finally {
    await pool
      .request()
      .input("q", sql.VarChar(32), quizCode)
      .input("t", sql.VarChar(32), tutorCode)
      .query(
        `DELETE FROM novedu_usage_by_code WHERE code IN (@q, @t);
           DELETE FROM novedu_codes WHERE code IN (@q, @t);`,
      )
      .catch(() => {});
    await pool.close();
  }
});
