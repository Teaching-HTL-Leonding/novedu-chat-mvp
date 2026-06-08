import { expect, test } from "@playwright/test";

// These tests exercise the full stack: the page POSTs a public URL to
// /api/validate-tutor, which fetches the stable sample tutors from GitHub,
// validates + assembles them, and returns the result. The sample files under
// tutors/ are kept stable on `main` precisely so these URLs stay valid.

const RAW =
  "https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/tutors";
const VALID_TUTOR_URL = `${RAW}/simple-tutor.yaml`;
const BROKEN_TUTOR_URL = `${RAW}/broken-tutor.yaml`;

// Network round-trip to GitHub + Next dev compilation — give it room.
test.setTimeout(60_000);

test("renders the assembled system prompt for a valid tutor", async ({ page }) => {
  await page.goto("/validate-tutor");

  await page.getByRole("textbox").fill(VALID_TUTOR_URL);
  await page.getByRole("button", { name: "Validate" }).click();

  // The prompt is shown as a markdown source block (label + copy button).
  await expect(page.getByText("markdown")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /copy code/i })).toBeVisible();

  // Assert on the source block's text content (robust to syntax-highlight token spans).
  const source = page.locator('code[class*="language-"]');
  await expect(source).toContainText("basic arithmetic"); // persona {{subject}}
  await expect(source).toContainText("Never give the final answer immediately."); // {{#each}}
  await expect(source).toContainText("Always stay positive and patient"); // tutor_instructions last
});

test("shows consistency errors for a broken tutor", async ({ page }) => {
  await page.goto("/validate-tutor");

  await page.getByRole("textbox").fill(BROKEN_TUTOR_URL);
  await page.getByRole("button", { name: "Validate" }).click();

  // The broken tutor omits a required variable and references a missing fragment.
  await expect(page.getByText("MISSING_REQUIRED_VARIABLE")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("FRAGMENT_NOT_FOUND")).toBeVisible();
});
