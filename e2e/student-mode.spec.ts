import { expect, test } from "@playwright/test";
import { STORAGE_STATE, TEACHER_STORAGE_STATE } from "./auth.constants";

// "Student mode": a teacher temporarily experiences the app as a student. While
// active, every teacher surface must deny them exactly like a real student —
// with one exception: the visible "Student mode" pill whose Exit control
// restores their rights. The mode is a cookie, so page.request (same browser
// context) lets us also prove the API enforcement.

test.use({ storageState: TEACHER_STORAGE_STATE });

test("a teacher can enter student mode, is treated as a student, and can exit again", async ({
  page,
}) => {
  // Before: full teacher experience.
  await page.goto("/codes/new");
  await expect(page.getByRole("button", { name: "Create code" })).toBeVisible();

  // Enter student mode via the user menu.
  await page.getByRole("button", { name: /E2E Teacher/ }).click();
  await page.getByRole("menuitem", { name: "View as student" }).click();
  await expect(page.getByText("Student mode")).toBeVisible();

  // The current page re-renders as the student version (access denied)...
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create code" })).toHaveCount(0);

  // ...the teacher badge is gone and the nav hides teacher-only entries...
  await expect(page.getByRole("img", { name: "Teacher" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Validate Tutor" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Codes", exact: true })).toHaveCount(0);

  // ...and the server-side enforcement points deny like for a real student.
  await page.goto("/validate-tutor");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  const res = await page.request.post("/api/validate-tutor", {
    data: { url: "https://example.com/tutor.yaml" },
  });
  expect(res.status()).toBe(403);

  // Exit via the pill — rights come back immediately.
  await page.getByRole("button", { name: "Exit" }).click();
  await expect(page.getByText("Student mode")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Teacher" })).toBeVisible();
  await expect(page.getByRole("textbox")).toBeVisible(); // validate-tutor form again

  const restored = await page.request.post("/api/validate-tutor", {
    data: { url: "not-a-url" },
  });
  expect(restored.status()).toBe(400); // past the 403 gate, rejected as a bad URL
});

test("a student gains nothing by setting the student-mode cookie", async ({ browser }) => {
  // Defense check: the cookie only restricts, it must never grant. Use the
  // STUDENT state plus a hand-set cookie and confirm no teacher surface opens
  // and no pill appears (the pill is teacher-only chrome).
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  await context.addCookies([{ name: "student-mode", value: "1", domain: "localhost", path: "/" }]);
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.getByText("Student mode")).toHaveCount(0);
  await page.goto("/codes/new");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();

  await context.close();
});
