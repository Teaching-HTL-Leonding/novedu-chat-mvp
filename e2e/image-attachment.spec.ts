import path from "node:path";
import { expect, test } from "@playwright/test";
import { mintTutorCode, VISION_TUTOR_URL } from "./code.utils";

// A REAL multi-modal round-trip through the chat: attach an image and confirm
// the model actually saw it. This is the only @live image test — the upload-UI
// GATING (imageInput on/off → whether the attachments config is passed to
// CopilotKit, plus the upload-failure notice) is our code's contribution and is
// covered without a browser/LLM in tests/component/tutor-chat.browser.test.tsx.
// What's left here genuinely needs the SCCH vision model + the database.
//
// The vision tutor YAML is served by the shared local fixtures server (see
// code.utils.ts / test-fixtures/serve.mjs); the Next dev server fetches it
// server-side, so 127.0.0.1 resolves fine.

const RED_PNG = path.join(process.cwd(), "e2e", "fixtures", "red.png");

// Fixture fetch + Next compile can still be slow on first hit.
test.setTimeout(60_000);

async function openChat(page: import("@playwright/test").Page, tutorUrl: string) {
  const code = await mintTutorCode({ tutor: tutorUrl });
  await page.goto(`/${code}`);
  await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible({ timeout: 30_000 });
}

// A REAL multi-modal round-trip: attach a solid-red PNG and ask for its color.
// @live: needs the SCCH model endpoint + the database — excluded in CI (test:e2e:ci).
test("the tutor answers a question about an attached image", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  // Image upload + a full vision-model round-trip — give it room.
  test.setTimeout(120_000);
  await openChat(page, VISION_TUTOR_URL);

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

// The regression the red.png test above can never catch. GitHub #26 arrived as a
// 24.5 MP phone photo — ~3 MB of JPEG, ~4 MB once base64-inlined into the run
// body — and the vision path had never been exercised at that scale: the only
// live image test sent a handful of bytes. Normalization is what keeps the wire
// small, so this asserts the WHOLE chain at a realistic size: a multi-megapixel
// pick is decoded, resized and re-encoded in the browser, and the model still
// answers about the pixels.
//
// The photo is generated in the page rather than committed: a multi-megabyte
// binary fixture is not worth carrying, and a canvas produces one deterministically.
// @live: needs the SCCH model endpoint + the database — excluded in CI.
test("a multi-megapixel photo survives the whole path to the model", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  test.setTimeout(180_000);
  await openChat(page, VISION_TUTOR_URL);

  // 2400x1800 of NOISY green. The noise is the point: a flat colour compresses to
  // ~70 KB however many megapixels it has, which would make this a large-image
  // test in name only. Low-amplitude per-pixel jitter around a strong green
  // defeats the encoder and lands the file in the same few-megabyte range as a
  // real phone photo, while leaving the dominant colour unmistakable.
  const attachedBytes = await page.evaluate(async () => {
    const width = 2400;
    const height = 1800;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const image = ctx.createImageData(width, height);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const jitter = (Math.random() - 0.5) * 50;
      pixels[i] = 40 + jitter;
      pixels[i + 1] = 170 + jitter;
      pixels[i + 2] = 60 + jitter;
      pixels[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) throw new Error("toBlob failed");
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input not rendered");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return blob.size;
  });
  // Guard the guard: a fixture that quietly came out small would prove nothing.
  // (A solid-colour field of the same dimensions compresses to ~70 KB — hence
  // the noise above.)
  expect(attachedBytes).toBeGreaterThan(1_000_000);

  await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(1);
  const composer = page.getByTestId("copilot-chat-textarea");
  await composer.fill("What is the dominant color of the attached image? Answer with one word.");
  await page.getByTestId("copilot-send-button").click();

  const assistant = page.getByTestId("copilot-assistant-message").first();
  await expect(assistant).toBeVisible({ timeout: 90_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim(), { timeout: 90_000 })
    .toMatch(/green|grün|gruen/i);
});
