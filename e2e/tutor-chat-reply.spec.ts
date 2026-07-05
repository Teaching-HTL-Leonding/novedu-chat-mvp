import { loadEnvConfig } from "@next/env";
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { mintTutorCode, RAW_TUTORS } from "./code.utils";

// A REAL end-to-end chat, run once per LLM PROVIDER: open a tutor code, send
// "Hi!", and assert the tutor streams back a non-empty answer (content doesn't
// matter — only that it replies without error). Unlike `tutor-code-link.spec.ts`,
// this DOES hit the LLM; it also exercises the `tutor` agent's Mastra Memory (the
// turn is persisted to the configured Azure SQL store, scoped to the tutor code
// as resourceId).
//
// - SCCH: the stable GitHub-raw sample tutor, exactly as before.
// - Azure Foundry: proves Managed-Identity/`az login` auth + deployment-as-model
//   end-to-end through Mastra. Its tutor YAML is authored app-hosted through
//   /files/new (the quiz.spec pattern) because a fixture on GitHub `main` would
//   not exist before this change merges. Skipped when AZURE_FOUNDRY_ENDPOINT is
//   not set. The other module specs stay SCCH-only by design.
//
// CopilotKit v2 testids used here (discovered from the rendered chat):
//   - composer textarea: copilot-chat-textarea
//   - send button:       copilot-send-button (Enter does NOT submit)
//   - chat root:         copilot-chat (has data-copilot-running while streaming)
//   - messages:          copilot-user-message / copilot-assistant-message

// Read the dev server's .env the way Next does, so the Foundry skip mirrors
// exactly what the server sees.
loadEnvConfig(process.cwd());

const TUTOR_URL = `${RAW_TUTORS}/linked-list-tutor.yaml`;

// Minimal valid tutor (no fragment files) pointing at a Foundry deployment.
const FOUNDRY_TUTOR = `id: e2e-foundry-tutor
name: "E2E Foundry Tutor"
description: "A minimal tutor used to smoke-test the Azure Foundry provider."
llm:
  model: gpt-5.4-mini
  provider: Azure Foundry
prompt:
  tutor_instructions: |
    You are a friendly tutor. Answer briefly.
`;

// Fill "Hi!" into the composer and assert a non-empty assistant reply streams in.
async function sendAndExpectReply(page: Page): Promise<void> {
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
}

async function setEditorContent(page: Page, text: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

// GitHub fetch + Next compile + a full model round-trip — give it room.
test.setTimeout(120_000);

// @live: needs the real SCCH endpoint + Azure SQL — excluded in CI (test:e2e:ci).
test("sending a message gets a non-empty reply from the tutor", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  await page.goto(`/${await mintTutorCode({ tutor: TUTOR_URL })}`);
  await sendAndExpectReply(page);
});

test.describe("via Azure Foundry", () => {
  // Authoring the app-hosted tutor file needs a teacher session (the chat at
  // /<code> works for any signed-in user, so the teacher session covers both).
  test.use({ storageState: TEACHER_STORAGE_STATE });

  // @live: needs the Foundry endpoint (MI / `az login` with the Cognitive
  // Services OpenAI User role) + Azure SQL — excluded in CI (test:e2e:ci).
  test("sending a message gets a non-empty reply from a Foundry tutor", {
    tag: ["@live", "@live-llm"],
  }, async ({ page }) => {
    test.skip(!process.env.AZURE_FOUNDRY_ENDPOINT, "AZURE_FOUNDRY_ENDPOINT is not set");

    // 1. Author the tutor file (kind=tutor → strict-validated, then stored).
    const name = `e2e-foundry-tutor-${Date.now()}`;
    await page.goto("/files/new");
    await page.getByLabel(/Name/).fill(name);
    await page.getByLabel("Kind").selectOption("tutor");
    await setEditorContent(page, FOUNDRY_TUTOR);
    await page.getByRole("button", { name: "Validate & create" }).click();
    await expect(page).toHaveURL(new RegExp(`/files/edit/${name}$`), { timeout: 60_000 });

    // 2. Mint a tutor code pointing at the authored file's public URL and chat.
    const tutorUrl = `${new URL(page.url()).origin}/api/files/${name}`;
    await page.goto(`/${await mintTutorCode({ tutor: tutorUrl, note: "e2e foundry tutor" })}`);
    await sendAndExpectReply(page);

    // 3. Clean up the tutor file (no automatic GC; the minted code lingers like
    // the other mint-and-leave specs — harmless and tidied with the CI container).
    await page.goto(`/files/edit/${name}`);
    page.once("dialog", (dialog) => dialog.accept());
    const del = page.getByRole("button", { name: /delete/i }).first();
    if (await del.isVisible().catch(() => false)) await del.click();
  });
});
