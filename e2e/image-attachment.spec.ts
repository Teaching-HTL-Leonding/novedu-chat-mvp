import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { mintTutorCode } from "./tutor-code.utils";

// A REAL multi-modal round-trip through the chat: attach an image and confirm
// the model actually saw it. This is the only @live image test — the upload-UI
// GATING (imageInput on/off → whether the attachments config is passed to
// CopilotKit, plus the upload-failure notice) is our code's contribution and is
// covered without a browser/LLM in tests/component/tutor-chat.browser.test.tsx.
// What's left here genuinely needs the SCCH vision model + Azure SQL.
//
// The tutor fixtures are served from a LOCAL http server (the repo's own
// `tutors/` directory) instead of GitHub raw `main` like the other specs:
// vision-tutor.yaml is introduced on this branch, so it isn't on `main` yet —
// and serving locally keeps this spec independent of GitHub anyway. The Next
// dev server fetches tutor URLs server-side, so 127.0.0.1 resolves fine.

const TUTORS_DIR = path.join(process.cwd(), "tutors");
const RED_PNG = path.join(process.cwd(), "e2e", "fixtures", "red.png");

let server: http.Server;
let tutorsBaseUrl: string;

test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    // Serve only flat files out of tutors/ — basename() forecloses traversal.
    const name = path.basename(new URL(req.url ?? "/", "http://localhost").pathname);
    try {
      const body = await readFile(path.join(TUTORS_DIR, name));
      res.writeHead(200, { "content-type": "application/yaml" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  tutorsBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Local fixture fetch + Next compile can still be slow on first hit.
test.setTimeout(60_000);

async function openChat(page: import("@playwright/test").Page, tutorFile: string) {
  const code = await mintTutorCode({ tutor: `${tutorsBaseUrl}/${tutorFile}` });
  await page.goto(`/${code}`);
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible({ timeout: 30_000 });
}

// A REAL multi-modal round-trip: attach a solid-red PNG and ask for its color.
// @live: needs the SCCH model endpoint + Azure SQL — excluded in CI (test:e2e:ci).
test("the tutor answers a question about an attached image", { tag: "@live" }, async ({ page }) => {
  // Image upload + a full vision-model round-trip — give it room.
  test.setTimeout(120_000);
  await openChat(page, "vision-tutor.yaml");

  // Attach + ask. In a FULL parallel run the dev server may hard-reload this
  // page (Turbopack recompiles routes that other specs touch), silently wiping
  // the not-yet-sent chat state — so if the sent message never shows up in the
  // transcript, redo the attach/ask once on the freshly reloaded page.
  const sendImageQuestion = async () => {
    if ((await page.getByRole("button", { name: "Remove attachment" }).count()) === 0) {
      await page.locator('input[type="file"]').setInputFiles(RED_PNG);
      await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(1);
    }
    const composer = page.getByTestId("copilot-chat-textarea");
    await composer.fill("What is the dominant color of the attached image? Answer with one word.");
    await page.getByTestId("copilot-send-button").click();
  };
  await sendImageQuestion();
  const userMessage = page.getByTestId("copilot-user-message").first();
  try {
    await expect(userMessage).toBeVisible({ timeout: 10_000 });
  } catch {
    await sendImageQuestion();
    await expect(userMessage).toBeVisible({ timeout: 10_000 });
  }

  // The model must have SEEN the image: only the pixels say "red" — the
  // question text doesn't.
  const assistant = page.getByTestId("copilot-assistant-message").first();
  await expect(assistant).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim(), { timeout: 60_000 })
    .toMatch(/red|rot/i);

  // And no runtime-sync / agent error surfaced.
  await expect(page.getByText(/not found after runtime sync/i)).toHaveCount(0);
});
