import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { deleteCode, mintTutorCode, VALID_TUTOR_URL } from "./code.utils";
import { query } from "./db";

// Resume on reload (docs/chat.md → Resuming a conversation), over the REAL
// stack minus the LLM: the tab's `sessionStorage` entry, the resume action's
// idle check against the real SQL, and the snapshot runner answering the chat's
// `connect` with the stored messages. The conversation is seeded straight into
// the Mastra tables under the thread id the page stored, so no model is needed
// — hence @live-db, run in CI.

test.setTimeout(120_000);

const USER_TEXT = "RESUME-USER-MARKER what is a linked list?";
const ASSISTANT_TEXT = "RESUME-ASSISTANT-MARKER a chain of nodes.";
// The fixture tutor's description, shown only on the welcome screen.
const WELCOME_TEXT = "Synthetic tutor used only by automated tests";

let mintedCodes: string[] = [];
let seededThreads: string[] = [];

test.afterEach(async () => {
  try {
    if (seededThreads.length > 0) {
      await query(`DELETE FROM mastra.mastra_messages WHERE thread_id = ANY($1)`, [seededThreads]);
      await query(`DELETE FROM mastra.mastra_threads WHERE id = ANY($1)`, [seededThreads]);
    }
    for (const code of mintedCodes) await deleteCode(code);
  } catch (error) {
    console.error("tutor-resume cleanup failed (best-effort)", error);
  } finally {
    mintedCodes = [];
    seededThreads = [];
  }
});

/** Collects uncaught page errors and console errors for the whole visit. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** The `{ threadId, threadToken }` the tab remembers for `code`. */
async function storedThread(page: Page, code: string): Promise<{ threadId: string } | null> {
  const raw = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    `novedu.tutorThread.${code}`,
  );
  return raw ? (JSON.parse(raw) as { threadId: string }) : null;
}

/** Opens the tutor and waits until the chat mounted and the tab stored its thread. */
async function openTutor(page: Page, code: string): Promise<string> {
  await page.goto(`/${code}`);
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => storedThread(page, code)).not.toBeNull();
  const stored = await storedThread(page, code);
  if (!stored) throw new Error("no stored tutor thread");
  return stored.threadId;
}

/** Seeds a user + assistant turn under `threadId`, the last message `agoMs` old. */
async function seedConversation(code: string, threadId: string, agoMs: number): Promise<void> {
  seededThreads.push(threadId);
  const at = Date.now() - agoMs;
  const stamp = (ms: number) => new Date(ms).toISOString();
  await query(
    `INSERT INTO mastra.mastra_threads (id, "resourceId", title, "createdAt", "updatedAt", "createdAtZ", "updatedAtZ")
     VALUES ($1, $2, '', $3, $3, $4, $4)`,
    [threadId, code, stamp(at - 1000).replace("Z", ""), stamp(at - 1000)],
  );
  const messages = [
    { role: "user", text: USER_TEXT, at: at - 500 },
    { role: "assistant", text: ASSISTANT_TEXT, at },
  ];
  for (const message of messages) {
    // The v2 envelope, or the reader yields empty messages.
    await query(
      `INSERT INTO mastra.mastra_messages (id, thread_id, content, role, type, "createdAt", "createdAtZ")
       VALUES ($1, $2, $3, $4, 'v2', $5, $6)`,
      [
        randomUUID(),
        threadId,
        JSON.stringify({ format: 2, parts: [{ type: "text", text: message.text }] }),
        message.role,
        stamp(message.at).replace("Z", ""),
        stamp(message.at),
      ],
    );
  }
}

test("a reload brings back the tab's conversation, but not after an hour of silence", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  const code = await mintTutorCode({ tutor: VALID_TUTOR_URL });
  mintedCodes.push(code);
  const errors = watchErrors(page);

  const threadId = await openTutor(page, code);
  await expect(page.getByText(WELCOME_TEXT)).toBeVisible();
  await seedConversation(code, threadId, 2 * 60 * 1000);

  // Within the hour: the same thread, its messages restored, no welcome screen.
  await page.reload();
  await expect(page.getByTestId("copilot-user-message").getByText(USER_TEXT)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("copilot-assistant-message").getByText(ASSISTANT_TEXT),
  ).toBeVisible();
  await expect(page.getByTestId("copilot-user-message")).toHaveCount(1);
  await expect(page.getByText(WELCOME_TEXT)).toHaveCount(0);
  expect((await storedThread(page, code))?.threadId).toBe(threadId);

  // 61 minutes of silence: the reload starts fresh on a new thread.
  await query(
    `UPDATE mastra.mastra_messages
        SET "createdAtZ" = "createdAtZ" - interval '61 minutes',
            "createdAt" = "createdAt" - interval '61 minutes'
      WHERE thread_id = $1`,
    [threadId],
  );
  await page.reload();
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(WELCOME_TEXT)).toBeVisible();
  await expect(page.getByText(USER_TEXT)).toHaveCount(0);
  await expect.poll(async () => (await storedThread(page, code))?.threadId).not.toBe(threadId);

  expect(errors).toEqual([]);
});

// Smoke: opening a tutor requires a minted code (a DB write), so this cannot be
// untagged; CI runs it.
test("smoke: an anonymous tutor loads and reloads without an error", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  const code = await mintTutorCode({ tutor: VALID_TUTOR_URL });
  mintedCodes.push(code);
  const errors = watchErrors(page);

  const threadId = await openTutor(page, code);
  // An empty thread is never resumed: the reload gets a fresh one.
  await page.reload();
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(WELCOME_TEXT)).toBeVisible();
  await expect.poll(async () => (await storedThread(page, code))?.threadId).not.toBe(threadId);

  // An anonymous tutor has no history, and Start over warns that it is final.
  await expect(page.getByRole("button", { name: "Previous conversations" })).toHaveCount(0);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByText(/you cannot come back to this conversation later/)).toBeVisible();

  await expect(page.locator("[data-nextjs-dialog-root]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
