import { expect, type Page, test } from "@playwright/test";
import { unixSecondsToDatetimeLocal } from "../lib/datetime-local";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { BROKEN_TUTOR_URL, VALID_TUTOR_URL } from "./tutor-code.utils";

// The full teacher flow through the UI: enter a tutor URL and a note, pick a
// window in local time, create the Tutor Code — then prove the generated URL
// actually opens the chat. This crosses the whole feature: browser local-time
// conversion → server action validation → database row → code check on the
// chat page.

test.use({ storageState: TEACHER_STORAGE_STATE });

// GitHub fetch (the action validates the tutor YAML) + Next dev compilation.
test.setTimeout(90_000);

// Fills and submits the share form with a window of [now+startOffset, now+endOffset].
async function submitShareForm(
  page: Page,
  {
    tutor,
    startOffset,
    endOffset,
    note,
  }: { tutor: string; startOffset: number; endOffset: number; note?: string },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await page.goto("/share-tutor");
  await page.getByLabel("Tutor YAML URL").fill(tutor);
  if (note !== undefined) await page.getByLabel(/Note/).fill(note);
  await page.getByLabel(/Available from/).fill(unixSecondsToDatetimeLocal(now + startOffset));
  await page.getByLabel(/Available until/).fill(unixSecondsToDatetimeLocal(now + endOffset));
  await page.getByRole("button", { name: "Create Tutor Code" }).click();
}

// @live: the action stores the code in the live database (the dev server
// authenticates with the local `az login` identity) — excluded in CI.
test("a teacher creates a tutor code and its URL opens the chat", { tag: "@live" }, async ({
  page,
}) => {
  await submitShareForm(page, {
    tutor: VALID_TUTOR_URL,
    startOffset: -3600,
    endOffset: 3600,
    note: "e2e share flow",
  });

  // The chat URL appears in the copyable output field: origin + /<code>.
  const output = page.getByLabel("Tutor Code link", { exact: true });
  await expect(output).toBeVisible({ timeout: 30_000 });
  const link = await output.inputValue();
  expect(link).toMatch(/^http:\/\/localhost:3000\/[a-z0-9]{10}$/);

  // The generated URL opens the chat (the page re-checks it server-side).
  await page.goto(link);
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 30_000 });
});

// @live: this teacher's code must then show up on the Shared Tutor Codes page.
test("a created code is listed under Shared Tutor Codes with its note", { tag: "@live" }, async ({
  page,
}) => {
  const note = `e2e listed ${Date.now()}`;
  await submitShareForm(page, {
    tutor: VALID_TUTOR_URL,
    startOffset: -3600,
    endOffset: 3600,
    note,
  });
  await expect(page.getByLabel("Tutor Code link", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/tutor-codes");
  const row = page.getByRole("row").filter({ hasText: note });
  await expect(row).toHaveCount(1);
  // The tutor YAML URL is offered as a tooltip on the note cell.
  await expect(row.getByTitle(VALID_TUTOR_URL)).toHaveCount(1);
  // Open link + copy button are present.
  await expect(row.getByRole("link", { name: "Open" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy link" })).toBeVisible();
});

test("the window must end after it starts", async ({ page }) => {
  await submitShareForm(page, { tutor: VALID_TUTOR_URL, startOffset: 3600, endOffset: -3600 });

  await expect(page.getByText(/must be after its start/i)).toBeVisible();
  await expect(page.getByLabel("Tutor Code link", { exact: true })).toHaveCount(0);
});

test("a broken tutor is rejected at share time", async ({ page }) => {
  await submitShareForm(page, { tutor: BROKEN_TUTOR_URL, startOffset: -3600, endOffset: 3600 });

  await expect(page.getByText(/failed validation/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Tutor Code link", { exact: true })).toHaveCount(0);
});
