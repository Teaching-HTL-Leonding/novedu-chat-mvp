import { expect, type Page, test } from "@playwright/test";
import { unixSecondsToDatetimeLocal } from "../lib/datetime-local";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { BROKEN_TUTOR_URL, VALID_TUTOR_URL } from "./share-link.utils";

// The full teacher flow through the UI: enter a tutor URL, pick a window in
// local time, create the link — then prove the generated link actually opens
// the chat. This crosses the whole feature: browser local-time conversion →
// server action validation + signing → deep-link verification on the chat page.

test.use({ storageState: TEACHER_STORAGE_STATE });

// GitHub fetch (the action validates the tutor YAML) + Next dev compilation.
test.setTimeout(90_000);

// Fills and submits the share form with a window of [now+startOffset, now+endOffset].
async function submitShareForm(
  page: Page,
  { tutor, startOffset, endOffset }: { tutor: string; startOffset: number; endOffset: number },
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  await page.goto("/share-tutor");
  await page.getByLabel("Tutor YAML URL").fill(tutor);
  await page.getByLabel(/Available from/).fill(unixSecondsToDatetimeLocal(now + startOffset));
  await page.getByLabel(/Available until/).fill(unixSecondsToDatetimeLocal(now + endOffset));
  await page.getByRole("button", { name: "Create Share Link" }).click();
  return now;
}

test("a teacher creates a share link and the link opens the chat", async ({ page }) => {
  const now = await submitShareForm(page, {
    tutor: VALID_TUTOR_URL,
    startOffset: -3600,
    endOffset: 3600,
  });

  // The signed link appears in the copyable output field.
  const output = page.getByLabel("Share link");
  await expect(output).toBeVisible({ timeout: 30_000 });
  const link = await output.inputValue();
  const url = new URL(link);
  expect(url.searchParams.get("tutor")).toBe(VALID_TUTOR_URL);
  expect(url.searchParams.get("sig")).toMatch(/^[0-9a-f]{64}$/);
  // The window round-trips through the browser's local-time conversion
  // (datetime-local has minute precision, so seconds are truncated).
  expect(Number(url.searchParams.get("start"))).toBe(Math.floor((now - 3600) / 60) * 60);
  expect(Number(url.searchParams.get("end"))).toBe(Math.floor((now + 3600) / 60) * 60);

  // The generated link opens the chat (the page re-verifies it server-side).
  await page.goto(link);
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 30_000 });
});

// @live: LIVE Azure Table Storage round-trip (the dev server stores the link with
// the local `az login` identity, then resolves the short code server-side) —
// excluded in CI (test:e2e:ci).
test("the stored short link opens the same chat", { tag: "@live" }, async ({ page }) => {
  await submitShareForm(page, {
    tutor: VALID_TUTOR_URL,
    startOffset: -3600,
    endOffset: 3600,
  });

  const output = page.getByLabel("Short link");
  await expect(output).toBeVisible({ timeout: 30_000 });
  const shortLink = await output.inputValue();
  expect(shortLink).toMatch(/\/\?link=[a-z0-9]{10}$/);

  await page.goto(shortLink);
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 30_000 });
});

test("the window must end after it starts", async ({ page }) => {
  await submitShareForm(page, { tutor: VALID_TUTOR_URL, startOffset: 3600, endOffset: -3600 });

  await expect(page.getByText(/must be after its start/i)).toBeVisible();
  await expect(page.getByLabel("Share link")).toHaveCount(0);
});

test("a broken tutor is rejected at share time", async ({ page }) => {
  await submitShareForm(page, { tutor: BROKEN_TUTOR_URL, startOffset: -3600, endOffset: 3600 });

  await expect(page.getByText(/failed validation/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Share link")).toHaveCount(0);
});
