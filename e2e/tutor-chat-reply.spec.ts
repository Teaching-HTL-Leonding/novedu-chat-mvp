import { expect, test } from "@playwright/test";
import { makeShareLink, openWindow, RAW_TUTORS } from "./share-link.utils";

// A REAL end-to-end chat: open a signed share link, send "Hi!", and assert the
// tutor streams back a non-empty answer (content doesn't matter — only that it
// replies without error). Unlike `deep-link.spec.ts`, this DOES hit the LLM, so
// it depends on the SCCH model endpoint being reachable; it also exercises the
// `tutor` agent's Mastra Memory (the turn is persisted to the configured Azure
// SQL store, scoped to the signed-in e2e user's id).
//
// CopilotKit v2 testids used here (discovered from the rendered chat):
//   - composer textarea: copilot-chat-textarea
//   - send button:       copilot-send-button (Enter does NOT submit)
//   - chat root:         copilot-chat (has data-copilot-running while streaming)
//   - messages:          copilot-user-message / copilot-assistant-message

const TUTOR_URL = `${RAW_TUTORS}/linked-list-tutor.yaml`;

// GitHub fetch + Next compile + a full model round-trip — give it room.
test.setTimeout(120_000);

test("sending a message gets a non-empty reply from the tutor", async ({ page }) => {
  await page.goto(makeShareLink(openWindow(TUTOR_URL)));

  // Wait for the chat to initialize (the composer appears).
  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });

  // Send "Hi!" — fill the textarea and click the send button (Enter won't submit).
  await composer.fill("Hi!");
  await page.getByTestId("copilot-send-button").click();

  // The user's message is echoed into the transcript.
  await expect(page.getByTestId("copilot-user-message")).toContainText("Hi!");

  // The tutor must stream back an answer. Content is irrelevant — assert only that
  // an assistant message appears and ends up with non-empty text.
  const assistant = page.getByTestId("copilot-assistant-message");
  await expect(assistant).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout: 60_000 })
    .toBeGreaterThan(0);

  // And no runtime-sync / agent error surfaced.
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);
});
