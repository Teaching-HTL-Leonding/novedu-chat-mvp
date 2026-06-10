import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { BROKEN_TUTOR_URL, VALID_TUTOR_URL } from "./share-link.utils";

// These tests exercise the full stack: the page POSTs a public URL to
// /api/validate-tutor, which fetches the stable sample tutors from GitHub,
// validates + assembles them, and returns the result. The sample files under
// tutors/ are kept stable on `main` precisely so these URLs stay valid.
//
// Validate Tutor is teacher-only now, so this spec runs with the minted teacher
// session (the student-side denial is covered by permissions.spec.ts).
test.use({ storageState: TEACHER_STORAGE_STATE });

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
