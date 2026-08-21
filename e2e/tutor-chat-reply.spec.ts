import { loadEnvConfig } from "@next/env";
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { sendAndExpectReply } from "./chat.utils";
import { LIVE_TOOLS_TUTOR_URL, LIVE_TUTOR_URL, mintTutorCode } from "./code.utils";

// A REAL end-to-end chat, run once per LLM PROVIDER: open a tutor code, send
// "Hi!", and assert the tutor streams back a non-empty answer (content doesn't
// matter — only that it replies without error). Unlike `tutor-code-link.spec.ts`,
// this DOES hit the LLM; it also exercises the `tutor` agent's Mastra Memory (the
// turn is persisted to the configured Azure SQL store, scoped to the tutor code
// as resourceId).
//
// - SCCH: the local fixtures server's live-tutor.yaml (a real model).
// - Azure Foundry: proves Managed-Identity/`az login` auth + deployment-as-model
//   end-to-end through Mastra. Its tutor YAML is authored app-hosted through
//   /files/new (the quiz.spec pattern). Skipped when AZURE_FOUNDRY_ENDPOINT is
//   not set. The other module specs stay SCCH-only by design.
//
// The send-and-await-reply sequence itself is shared with the other module chat
// specs — `sendAndExpectReply` in e2e/chat.utils.ts.

// Read the dev server's .env the way Next does, so the Foundry skip mirrors
// exactly what the server sees.
loadEnvConfig(process.cwd());

// Minimal valid tutor (no fragment files) pointing at a Foundry deployment. It
// stays inline and is authored through /files/new — NOT a served fixture —
// because (a) the authoring pass is deliberate coverage of the save-time strict
// validation of a `provider: Azure Foundry` tutor, and (b) a Foundry deployment
// name is environment-specific, so it has no place in the content-stable
// fixture tree (docs/testing.md's fixture-model taxonomy).
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

async function setEditorContent(page: Page, text: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

// Fixture fetch + Next compile + a full model round-trip — give it room.
test.setTimeout(120_000);

// @live: needs the real SCCH endpoint + Azure SQL — excluded in CI (test:e2e:ci).
test("sending a message gets a non-empty reply from the tutor", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  await page.goto(`/${await mintTutorCode({ tutor: LIVE_TUTOR_URL })}`);
  await sendAndExpectReply(page);
});

// The tool round-trip: a tutor with `tools: [random_number]` is asked for a random
// number in a range the tool must be called for. Asserts the full server-side tool
// path (per-request tools resolver → Mastra tool execution → the result woven into
// the reply): the answer must carry a number INSIDE the requested range. A model
// inventing a plausible number could theoretically land in range too — but a broken
// tools path fails loudly (resolver throw = no reply; tool never called = gemma has
// no number to echo), so in-range + no error is a faithful smoke of the wiring.
// @live: needs the real SCCH endpoint + Azure SQL — excluded in CI (test:e2e:ci).
test("a tutor with the random_number tool weaves a tool result into its reply", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  await page.goto(`/${await mintTutorCode({ tutor: LIVE_TOOLS_TUTOR_URL })}`);

  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill("Give me a random number between 100000 and 999999.");
  await page.getByTestId("copilot-send-button").click();

  // After a tool round-trip the reply renders as TWO nodes with this testid (a
  // hidden tool-call wrapper + the visible text message) — take the last one.
  const assistant = page.getByTestId("copilot-assistant-message").last();
  await expect(assistant).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const text = (await assistant.innerText()).trim();
        const match = text.match(/\b(\d{6})\b/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThanOrEqual(100_000);
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);
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
