import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { E2E_STUDENT } from "./auth.constants";
import { mintCode, PER_USER_TUTOR_URL } from "./code.utils";
import { query } from "./db";
import { watchErrors } from "./page.utils";

// "Previous conversations" in a per-user tutor (docs/chat.md), over the REAL
// stack minus the LLM: the both-flags gate, the student-side list SQL scoped to
// the session user and this code, the reopen action, and the snapshot runner's
// ownership branch for a conversation older than the resume limit. Conversations
// and their `novedu_user_chats` rows are seeded directly — hence @live-db, run in CI.

const WELCOME_TEXT = "Synthetic per-user tutor used only by automated tests";
const DAY = 24 * 60 * 60 * 1000;

function mintPerUserCode(): Promise<string> {
  return mintCode({ module: "tutor", file: PER_USER_TUTOR_URL, anonymous: false });
}

/**
 * A conversation of `userId` under `code`: the attribution row plus a Mastra
 * thread with one user and one assistant message, the last `agoMs` old.
 */
async function seedOwnConversation(
  code: string,
  question: string,
  agoMs: number,
  userId: string = E2E_STUDENT.id,
): Promise<string> {
  const threadId = randomUUID();
  const at = Date.now() - agoMs;
  const stamp = (ms: number) => new Date(ms).toISOString();
  await query(
    `INSERT INTO mastra.mastra_threads (id, "resourceId", title, "createdAt", "updatedAt", "createdAtZ", "updatedAtZ")
     VALUES ($1, $2, '', $3, $3, $4, $4)`,
    [threadId, code, stamp(at - 1000).replace("Z", ""), stamp(at - 1000)],
  );
  const messages = [
    { role: "user", text: question, at: at - 500 },
    { role: "assistant", text: `ANSWER to ${question}`, at },
  ];
  for (const message of messages) {
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
  await query(
    `INSERT INTO novedu_user_chats (thread_id, code, user_id, created_at) VALUES ($1, $2, $3, now())`,
    [threadId, code, userId],
  );
  return threadId;
}

async function openTutor(page: Page, code: string) {
  await page.goto(`/${code}`);
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
}

test("lists only this code's own conversations, reopens one, and a reload keeps it", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  const code = await mintPerUserCode();
  const otherCode = await mintPerUserCode();
  const errors = watchErrors(page);

  await seedOwnConversation(code, "HIST-RECENT what is recursion?", 2 * DAY);
  const older = await seedOwnConversation(code, "HIST-OLDER what is a stack?", 5 * DAY);
  await seedOwnConversation(otherCode, "HIST-OTHER-CODE never listed", DAY);
  await seedOwnConversation(code, "HIST-OTHER-USER never listed", DAY, "e2e-teacher");

  await openTutor(page, code);
  await page.getByRole("button", { name: "Previous conversations" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/This tutor is not anonymous/)).toBeVisible();

  // Only this code's conversations of THIS user, newest first; the fresh, still
  // empty current thread has no row.
  const rows = dialog.getByTestId("previous-conversation");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("HIST-RECENT");
  await expect(rows.nth(1)).toContainText("HIST-OLDER");
  await expect(rows.nth(1)).toContainText("1 message");
  await expect(dialog.getByText("HIST-OTHER-CODE")).toHaveCount(0);
  await expect(dialog.getByText("HIST-OTHER-USER")).toHaveCount(0);

  // Reopen the five-day-old one: its messages arrive with the connect.
  await rows.nth(1).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("copilot-user-message").getByText("HIST-OLDER")).toBeVisible();
  await expect(
    page.getByTestId("copilot-assistant-message").getByText("ANSWER to HIST-OLDER"),
  ).toBeVisible();
  await expect(page.getByText(WELCOME_TEXT)).toHaveCount(0);

  // A reload keeps the reopened conversation, although it is older than an hour.
  await page.reload();
  await expect(page.getByTestId("copilot-user-message").getByText("HIST-OLDER")).toBeVisible();
  const stored = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    `novedu.tutorThread.${code}`,
  );
  expect(JSON.parse(stored ?? "{}").threadId).toBe(older);

  // Now it is the current one in the list.
  await page.getByRole("button", { name: "Previous conversations" }).click();
  await expect(rows.filter({ hasText: "HIST-OLDER" })).toContainText("Current");
  await expect(rows.filter({ hasText: "HIST-OLDER" })).toBeDisabled();

  expect(errors).toEqual([]);
});

test("smoke: a per-user tutor loads, reloads, and shows an empty history", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  const code = await mintPerUserCode();
  const errors = watchErrors(page);

  await openTutor(page, code);
  await page.reload();
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  await expect(page.getByText(WELCOME_TEXT)).toBeVisible();

  await page.getByRole("button", { name: "Previous conversations" }).click();
  await expect(
    page.getByRole("dialog").getByText("No earlier conversations with this tutor yet."),
  ).toBeVisible();
  // The per-user wording of Start over.
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByText("Start a new conversation?")).toBeVisible();

  await expect(page.locator("[data-nextjs-dialog-root]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
