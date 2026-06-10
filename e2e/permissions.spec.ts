import { expect, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// Authorization (not authentication) enforcement: signed-in students must be
// kept out of the teacher-only surfaces, and teachers must get in. The student
// runs on the project-default storage state (minted without the isTeacher
// claim); the teacher block opts into the teacher state.

test.describe("as a student", () => {
  test("the Validate Tutor page is denied", async ({ page }) => {
    await page.goto("/validate-tutor");

    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    // No URL form is rendered.
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("the Share Tutor page is denied", async ({ page }) => {
    await page.goto("/share-tutor");

    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Share Link" })).toHaveCount(0);
  });

  test("the validate-tutor API responds 403", async ({ page }) => {
    // The API is the enforcement point (the page check is only UX) — hit it
    // directly with the student's session cookie.
    const res = await page.request.post("/api/validate-tutor", {
      data: { url: "https://example.com/tutor.yaml" },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.errors[0].code).toBe("FORBIDDEN");
  });

  test("the chat backend rejects requests without a valid share link", async ({ page }) => {
    const res = await page.request.get("/api/copilotkit/info", {
      headers: { "x-tutor-url": "https://example.com/tutor.yaml" },
    });

    expect(res.status()).toBe(403);
  });

  test("the nav menu hides teacher-only entries", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation menu" }).click();

    await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Validate Tutor" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Share Tutor" })).toHaveCount(0);
  });
});

test.describe("as a teacher", () => {
  test.use({ storageState: TEACHER_STORAGE_STATE });

  test("the Validate Tutor page is accessible", async ({ page }) => {
    await page.goto("/validate-tutor");

    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByRole("button", { name: "Validate" })).toBeVisible();
  });

  test("the Share Tutor page is accessible", async ({ page }) => {
    await page.goto("/share-tutor");

    await expect(page.getByLabel("Tutor YAML URL")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Share Link" })).toBeVisible();
  });

  test("the nav menu shows the teacher-only entries", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation menu" }).click();

    await expect(page.getByRole("link", { name: "Validate Tutor" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Share Tutor" })).toBeVisible();
  });
});
