import { randomInt } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { expect, type Page, test } from "@playwright/test";
import sql from "mssql";
import { buildMssqlConnectionConfig } from "../lib/azure-credential";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { mintCode } from "./code.utils";

// End-to-end coverage for the Writing module: a `novedu_codes` row with
// `module: "writing"` reached at `/<code>`. The student writes Markdown on the
// left, SAVES it (one row per (code, student) in `novedu_writing_submissions`),
// and a teacher reviews saved texts on /codes/[code].
//
// The write → save → reload-restores → teacher-review legs need the DB but no LLM
// (@live-db, run in CI against the ephemeral SQL container). The "assistant reads
// the draft via getCurrentText" leg DOES hit the SCCH model, so it is split into a
// separate @live-llm test (excluded from CI) — a `--grep @live-db` run skips it.
//
// CopilotKit v2 testids (shared with the tutor/quiz chats):
//   copilot-chat-textarea, copilot-send-button, copilot-assistant-message.

test.use({ storageState: TEACHER_STORAGE_STATE });
test.setTimeout(120_000);

// A minimal attributed (anonymous: false) writing activity. anonymous:false is
// what enables Save + prefill + the teacher review showing text.
const SAMPLE_WRITING = `id: e2e-writing
name: "E2E Writing"
title: "E2E Writing"
anonymous: false
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
instructions: |
  You are a writing coach. Use the getCurrentText tool to read the student's
  current draft, then state the EXACT first line of it back, verbatim.
`;

async function setCodeMirrorContent(page: Page, text: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

// Authors a writing file via the teacher /files flow and mints a writing code for
// it. Returns the code + the file name (the caller cleans up the file).
async function authorWritingCode(page: Page): Promise<{ code: string; name: string }> {
  // A per-call unique name so tests authoring files in parallel never collide on
  // the active-name unique index (a collision keeps the page on /files/new).
  const name = `e2e-writing-${Date.now()}-${randomInt(1_000_000)}`;
  await page.goto("/files/new");
  await page.getByLabel(/Name/).fill(name);
  await page.getByLabel("Kind").selectOption("writing");
  await setCodeMirrorContent(page, SAMPLE_WRITING);
  await page.getByRole("button", { name: "Validate & create" }).click();
  await expect(page).toHaveURL(new RegExp(`/files/edit/${name}$`), { timeout: 60_000 });

  const fileUrl = `${new URL(page.url()).origin}/api/files/${name}`;
  const code = await mintCode({ module: "writing", file: fileUrl });
  return { code, name };
}

async function deleteFile(page: Page, name: string): Promise<void> {
  await page.goto(`/files/edit/${name}`);
  page.once("dialog", (dialog) => dialog.accept());
  const del = page.getByRole("button", { name: /delete/i }).first();
  if (await del.isVisible().catch(() => false)) await del.click();
}

// write → save → reload restores → teacher review shows the saved text. No LLM.
test("write → save → reload restores → teacher review", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  const { code, name } = await authorWritingCode(page);
  const DRAFT = `# My essay\n\nThis is my first draft about linked lists.`;

  // 1. Open the writing activity and write a draft.
  await page.goto(`/${code}`);
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
  await setCodeMirrorContent(page, DRAFT);

  // 2. Save it. The button flips Save → Saved on success.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 30_000 });

  // 3. Reload: the saved draft is prefilled back into the editor.
  await page.goto(`/${code}`);
  await expect(page.locator(".cm-content")).toContainText("first draft about linked lists", {
    timeout: 30_000,
  });

  // 4. Teacher review on /codes/[code] shows the saved text (rendered markdown).
  await page.goto(`/codes/${code}`);
  await expect(page.getByRole("heading", { name: "Submissions" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("first draft about linked lists")).toBeVisible();

  await deleteFile(page, name);
});

// The assistant reads the LIVE editor buffer through the read-only getCurrentText
// frontend tool. Tagged @live-llm only (it also writes the DB, but an LLM test
// implies the DB — tagging @live-db too would make a CI `--grep @live-db` run
// select it and fail without the model).
test("the assistant reads the draft via getCurrentText", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  test.setTimeout(180_000);
  const { code, name } = await authorWritingCode(page);

  await page.goto(`/${code}`);
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
  await setCodeMirrorContent(page, "BANANAPHONE is my opening line.\n\nThen the essay continues.");

  // Ask the coach to read the draft; the agent calls getCurrentText and echoes the
  // first line, so the unique sentinel must appear in its reply.
  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill("Read my draft and state my exact first line.");
  await page.getByTestId("copilot-send-button").click();

  // The agent emits an intermediate tool-status message before its final reply, so
  // assert on the LAST assistant message (the text answer), not the whole set —
  // toContainText over a multi-element locator would trip strict mode.
  const assistant = page.getByTestId("copilot-assistant-message").last();
  await expect(assistant).toBeVisible({ timeout: 60_000 });
  await expect(assistant).toContainText("BANANAPHONE", { timeout: 90_000 });
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);

  await deleteFile(page, name);
});

// The store round-trip, against the real table — upsert (insert then update on the
// same key) and listSubmissions ordering, then the code-delete row cleanup. Uses the
// plain `mssql` driver (the Playwright CJS runner cannot load drizzle's ESM), with
// statements that mirror lib/writing-store.ts. Needs the DB, no LLM.
test("writing submissions store round-trip (upsert / list / delete)", {
  tag: ["@live", "@live-db"],
}, async () => {
  loadEnvConfig(process.cwd());
  const connectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!connectionString) throw new Error("e2e: MSSQL_CONNECTION_STRING is not set");
  const pool = await new sql.ConnectionPool(buildMssqlConnectionConfig(connectionString)).connect();

  const suffix = randomInt(1_000_000).toString().padStart(6, "0");
  const code = `e2ewr${suffix}`;
  const userA = `e2e-user-a-${suffix}`;
  const userB = `e2e-user-b-${suffix}`;

  const upsert = async (userId: string, text: string) => {
    // Mirrors saveSubmission's insert→update-on-duplicate-key upsert.
    await pool
      .request()
      .input("code", sql.VarChar(32), code)
      .input("userId", sql.NVarChar(64), userId)
      .input("text", sql.NVarChar(sql.MAX), text)
      .input("now", sql.DateTime2, new Date())
      .query(
        `MERGE novedu_writing_submissions AS t
         USING (SELECT @code AS code, @userId AS user_id) AS s
         ON t.code = s.code AND t.user_id = s.user_id
         WHEN MATCHED THEN UPDATE SET text = @text, text_updated_at = @now
         WHEN NOT MATCHED THEN INSERT (code, user_id, text, text_updated_at)
           VALUES (@code, @userId, @text, @now);`,
      );
  };

  const list = async () =>
    (
      await pool
        .request()
        .input("code", sql.VarChar(32), code)
        .query<{ user_id: string; text: string }>(
          `SELECT user_id, CAST(text AS NVARCHAR(MAX)) AS text
           FROM novedu_writing_submissions
           WHERE code = @code
           ORDER BY text_updated_at DESC`,
        )
    ).recordset;

  try {
    await upsert(userA, "first version");
    // Upsert again on the SAME (code, user) key: one row, updated text.
    await upsert(userA, "second version");
    const afterUpdate = await list();
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0]?.text).toBe("second version");

    // A second student adds a row; listSubmissions returns newest first.
    await upsert(userB, "b's text");
    const both = await list();
    expect(both.map((r) => r.user_id)).toEqual([userB, userA]);

    // The code-delete path drops every row for the code.
    await pool
      .request()
      .input("code", sql.VarChar(32), code)
      .query(`DELETE FROM novedu_writing_submissions WHERE code = @code`);
    expect(await list()).toHaveLength(0);
  } finally {
    await pool
      .request()
      .input("code", sql.VarChar(32), code)
      .query(`DELETE FROM novedu_writing_submissions WHERE code = @code`)
      .catch(() => {});
    await pool.close();
  }
});
