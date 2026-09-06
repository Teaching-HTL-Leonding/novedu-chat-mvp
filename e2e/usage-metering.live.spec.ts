import { expect, test } from "@playwright/test";
import { LIVE_TUTOR_URL, mintTutorCode } from "./code.utils";
import { query } from "./db";

// A REAL end-to-end metering check: open a tutor code, send a message, get a reply,
// then assert the observability exporter wrote a usage row for that code —
// token counts AND the user-message counter — into `novedu_usage_by_code`.
//
// This needs the SCCH LLM (a real generation produces the MODEL_GENERATION span the
// exporter meters) AND the DB, so it is tagged `@live-llm` (the DB it also uses is
// implied) — local only, never CI. Uses the shared `e2e/db.ts` plain `pg` helper
// (kept independent of the app's query layer), mirroring the
// store round-trip in `e2e/writing.spec.ts`. Metering is written OFF the response
// path (the exporter is async; the `user_messages` counter runs in `after()`), so
// the DB read POLLS until the row lands. See docs/usage-metering.md.

// Fixture fetch + Next compile + a full model round-trip + the metering write.
test.setTimeout(150_000);

test("a real tutor chat meters tokens + the user message into usage_by_code", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  const code = await mintTutorCode({ tutor: LIVE_TUTOR_URL });

  // One real round-trip so a MODEL_GENERATION span fires and the run completes.
  await page.goto(`/${code}`);
  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill("Hi!");
  await page.getByTestId("copilot-send-button").click();
  const assistant = page.getByTestId("copilot-assistant-message");
  await expect(assistant).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout: 60_000 })
    .toBeGreaterThan(0);

  // The code's row summed over hours (a run could straddle an hour boundary).
  const readRow = async () =>
    (
      await query<{
        module: string;
        input_tokens_new: number | string;
        input_tokens_cached: number | string;
        output_tokens: number | string;
        tool_calls: number;
        user_messages: number;
      }>(
        `SELECT MAX(module) AS module,
                  SUM(input_tokens_new) AS input_tokens_new,
                  SUM(input_tokens_cached) AS input_tokens_cached,
                  SUM(output_tokens) AS output_tokens,
                  SUM(tool_calls) AS tool_calls,
                  SUM(user_messages) AS user_messages
           FROM novedu_usage_by_code WHERE code = $1`,
        [code],
      )
    )[0];

  try {
    // Poll until BOTH the async token export AND the after() user-message counter land.
    await expect
      .poll(
        async () => {
          const r = await readRow();
          return Number(r?.output_tokens ?? 0) > 0 && Number(r?.user_messages ?? 0) >= 1;
        },
        { timeout: 45_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);

    const row = await readRow();
    expect(row?.module).toBe("tutor");
    // A tutor turn has no tool calls; the token split accounts for the whole prompt.
    const inputNew = Number(row?.input_tokens_new ?? 0);
    const inputCached = Number(row?.input_tokens_cached ?? 0);
    expect(Number(row?.output_tokens ?? 0)).toBeGreaterThan(0);
    expect(inputNew + inputCached).toBeGreaterThan(0);
  } finally {
    // Clean up this test's usage rows (the shared per-user bucket is left intact).
    await query(`DELETE FROM novedu_usage_by_code WHERE code = $1`, [code]).catch(() => {});
  }
});
