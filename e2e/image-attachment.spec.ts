import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeShareLink, openWindow } from "./share-link.utils";

// Image attachments in the chat. They are ON by default; a tutor opts out via
// `llm.imageInput: false` (text-only-tutor.yaml), which must remove the upload
// UI entirely.
//
// The tutor fixtures are served from a LOCAL http server (the repo's own
// `tutors/` directory) instead of GitHub raw `main` like the other specs:
// vision-tutor.yaml is introduced on this branch, so it isn't on `main` yet —
// and serving locally keeps these specs independent of GitHub anyway. The Next
// dev server fetches tutor URLs server-side, so 127.0.0.1 resolves fine.
//
// CopilotKit v2 testids/labels used here (discovered from the rendered chat):
//   - hidden file input:   input[type="file"] (carries the accept filter; the
//                          visible "+" toolbar button has NO accessible name —
//                          "Add attachments" is only its hover tooltip — so the
//                          input is the reliable presence signal)
//   - attachment chips:    copilot-attachment-queue (one "Remove attachment"
//                          button per queued file)

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
  await page.goto(makeShareLink(openWindow(`${tutorsBaseUrl}/${tutorFile}`)));
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible({ timeout: 30_000 });
}

test("a vision tutor lets the student attach an image and remove it again", async ({ page }) => {
  await openChat(page, "vision-tutor.yaml");

  // The upload control is present and restricted to images. (The input is
  // intentionally hidden — the toolbar button proxies clicks to it — so assert
  // presence, not visibility.)
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);
  await expect(fileInput).toHaveAttribute("accept", "image/*");

  // Attach the fixture straight through the (hidden) input — the file chooser
  // itself is native UI Playwright can't drive.
  await fileInput.setInputFiles(RED_PNG);
  const queue = page.getByTestId("copilot-attachment-queue");
  await expect(queue).toBeVisible();
  const removeButton = page.getByRole("button", { name: "Remove attachment" });
  await expect(removeButton).toHaveCount(1);

  // Removing the chip empties the queue without sending anything.
  await removeButton.click();
  await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(0);
});

test("a tutor with imageInput: false shows no upload UI", async ({ page }) => {
  await openChat(page, "text-only-tutor.yaml");

  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("a tutor that says nothing about imageInput gets the upload UI (on by default)", async ({
  page,
}) => {
  await openChat(page, "simple-tutor.yaml");

  await expect(page.locator('input[type="file"]')).toHaveCount(1);
});

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
