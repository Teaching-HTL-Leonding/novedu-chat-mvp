import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { BROKEN_TUTOR_URL, VALID_TUTOR_URL } from "./code.utils";

// These tests exercise the full stack: the page POSTs a URL to
// /api/validate-tutor, which fetches the fixture tutors from the local fixtures
// server (served server-side), validates + assembles them, and returns the result.
//
// Validate Tutor is teacher-only now, so this spec runs with the minted teacher
// session (the student-side denial is covered by permissions.spec.ts).
test.use({ storageState: TEACHER_STORAGE_STATE });

// Fixtures-server fetch + Next dev compilation — give it room. (A failure of the
// local fixtures webServer surfaces here as FETCH_FAILED from /api/validate-tutor.)
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
  await expect(source).toContainText("SUBJECT-MARKER"); // persona {{subject}}
  await expect(source).toContainText("RULE-ONE-MARKER"); // {{#each}}
  await expect(source).toContainText("INSTRUCTIONS-MARKER"); // tutor_instructions last
});

test("shows consistency errors for a broken tutor", async ({ page }) => {
  await page.goto("/validate-tutor");

  await page.getByRole("textbox").fill(BROKEN_TUTOR_URL);
  await page.getByRole("button", { name: "Validate" }).click();

  // The broken tutor omits a required variable and references a missing fragment.
  await expect(page.getByText("MISSING_REQUIRED_VARIABLE")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("FRAGMENT_NOT_FOUND")).toBeVisible();
});
