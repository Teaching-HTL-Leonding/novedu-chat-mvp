import { expect, type Page } from "@playwright/test";

// The one send-a-message-and-wait-for-a-reply sequence the @live-llm chat specs
// share. Every module's chat is the same `ModuleChat` (docs/chat.md), so the
// CopilotKit v2 testids and the wait shape are identical across tutor, quiz
// discussion and writing — only the message and how long the model may take
// differ. Specs that assert something about the CONTENT of the reply drive the
// composer themselves; this helper only proves that SOME answer streamed back
// without an error.
//
// CopilotKit v2 testids used here (discovered from the rendered chat):
//   - composer textarea: copilot-chat-textarea
//   - send button:       copilot-send-button (Enter does NOT submit)
//   - messages:          copilot-user-message / copilot-assistant-message

export async function sendAndExpectReply(
  page: Page,
  options: { message?: string; timeout?: number } = {},
): Promise<void> {
  const message = options.message ?? "Hi!";
  const timeout = options.timeout ?? 60_000;

  // Wait for the chat to initialize (the composer appears), then send.
  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(message);
  await page.getByTestId("copilot-send-button").click();

  // The user's message is echoed into the transcript.
  await expect(page.getByTestId("copilot-user-message").last()).toContainText(message);

  // The agent must stream back an answer. Content is irrelevant — assert only
  // that an assistant message appears and ends up with non-empty text. After a
  // tool round-trip the reply renders as SEVERAL nodes with this testid (a hidden
  // tool-call wrapper + the visible text message), so take the last one.
  const assistant = page.getByTestId("copilot-assistant-message").last();
  await expect(assistant).toBeVisible({ timeout });
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout })
    .toBeGreaterThan(0);

  // And no runtime-sync / agent error surfaced.
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);
}
