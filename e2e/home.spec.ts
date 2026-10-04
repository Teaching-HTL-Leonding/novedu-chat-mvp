import { expect, type Page, test } from "@playwright/test";
import { STUDENT_MODE_COOKIE } from "../lib/student-mode-constants";
import { STORAGE_STATE, TEACHER_STORAGE_STATE } from "./auth.constants";
import { deletePrincipal, signInFreshStudent } from "./principal.utils";

// Smoke: the start page opens without an error for every kind of visitor — a
// student, a teacher, a teacher viewing as a student, and a brand-new student
// with no history at all (the empty state). Hermetic: the fresh principal's
// auth rows are the only writes, removed again afterwards.

/** Collects uncaught page errors and console errors for the whole visit. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** Every section rendered, or showing its "unavailable" note — never an error boundary. */
async function expectHomeRendered(page: Page) {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  // Continue comes first, with the code field.
  const headings = page.getByRole("heading", { level: 2 });
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome back/ })).toBeVisible();
  await expect(page.getByLabel("Code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open", exact: true })).toBeVisible();

  for (const title of [
    "Recently used",
    "Your progress",
    "Your last 26 weeks",
    "Almost there",
    "Badges",
  ]) {
    await expect(headings.filter({ hasText: title })).toBeVisible();
  }
  // The privacy promise is part of the page, not a detail.
  await expect(page.getByText("Your progress here is only visible to you.")).toBeVisible();

  // No Next.js error overlay (dev) and no error boundary.
  await expect(page.locator("[data-nextjs-dialog-root]")).toHaveCount(0);
  await expect(page.getByText(/Application error|Something went wrong/)).toHaveCount(0);
}

test.describe("as the student principal", () => {
  test.use({ storageState: STORAGE_STATE });

  test("the start page opens without errors", async ({ page }) => {
    const errors = watchErrors(page);
    await expectHomeRendered(page);
    expect(errors).toEqual([]);
  });
});

test.describe("as the teacher principal", () => {
  test.use({ storageState: TEACHER_STORAGE_STATE });

  test("the start page opens without errors", async ({ page }) => {
    const errors = watchErrors(page);
    await expectHomeRendered(page);
    expect(errors).toEqual([]);
  });

  test("in view-as-student mode the start page opens without errors", async ({ page, context }) => {
    await context.addCookies([
      { name: STUDENT_MODE_COOKIE, value: "1", domain: "localhost", path: "/" },
    ]);
    const errors = watchErrors(page);
    await expectHomeRendered(page);
    await expect(page.getByText("Student mode")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("as a brand-new student", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the empty state: level 1, no streak, an empty calendar, no strip", async ({
    page,
    context,
  }) => {
    const principal = await signInFreshStudent(context, "Nova Newcomer");
    try {
      const errors = watchErrors(page);
      await expectHomeRendered(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome back, Nova");

      const progress = page.getByRole("region", { name: "Your progress" });
      await expect(progress.getByRole("progressbar")).toHaveAttribute(
        "aria-valuetext",
        "0 XP, level 1, 100 XP to level 2",
      );
      await expect(progress).toContainText("0weeks in a row");
      await expect(progress.getByText("Be active this week to start a streak.")).toBeVisible();

      await expect(page.getByText("Your first active day will show up here.")).toBeVisible();
      await expect(
        page.locator('[data-level="1"], [data-level="2"], [data-level="3"]'),
      ).toHaveCount(0);
      await expect(
        page.getByRole("group", { name: /^Activity calendar: 0 active days/ }),
      ).toBeVisible();

      await expect(page.getByText(/new badges? since your last visit/)).toHaveCount(0);
      await expect(page.getByText("Badges you're close to will show up here.")).toBeVisible();
      await expect(page.getByText("Activities you open show up here")).toBeVisible();
      await expect(page.getByText("0 earned")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await deletePrincipal(principal.id);
    }
  });
});
