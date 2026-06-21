import { expect, type Page, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// End-to-end coverage for the YAML File hosting feature. The authorization gate
// and the create-form validation behavior are hermetic (run in CI). The full
// create → list → update → delete cycle is `@live` and lives in
// `file-and-tutor-code-crud.spec.ts` (which also covers the tutor-link CRUD).

// Replace the CodeMirror document with `text`. `insertText` inserts verbatim
// (like a paste) so YAML indentation/newlines survive — unlike per-key typing,
// which CodeMirror would auto-indent.
async function setEditorContent(page: Page, text: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

test.describe("as a student", () => {
  // Runs on the project-default (student) storage state.
  test("the YAML Files page is denied", async ({ page }) => {
    await page.goto("/files");

    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("the nav menu hides the YAML Files entry", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation menu" }).click();

    await expect(page.getByRole("link", { name: "YAML Files" })).toHaveCount(0);
  });
});

test.describe("as a teacher", () => {
  test.use({ storageState: TEACHER_STORAGE_STATE });
  // Dev compilation of the routes + validation.
  test.setTimeout(90_000);

  // Hermetic: a fragment with invalid YAML fails validation locally (no DB, no
  // network), so this verifies the create form keeps the entered name and kind
  // when the save is rejected — React resets uncontrolled form fields after an
  // action, so they must be controlled.
  test("a rejected create keeps the entered name and kind", async ({ page }) => {
    await page.goto("/files/new");
    await page.getByLabel(/Name/).fill("keep-this-name");
    await page.getByLabel("Kind").selectOption("fragment");
    await setEditorContent(page, "id: incomplete\nfragments: []\n");
    await page.getByRole("button", { name: "Validate & create" }).click();

    // The detailed validator errors are shown (not just a generic message)…
    await expect(page.getByRole("heading", { name: /Validation failed/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("FRAGMENT_FILE_SCHEMA_ERROR")).toBeVisible();
    // …and the entered name and kind are preserved across the rejected submit.
    await expect(page.getByLabel(/Name/)).toHaveValue("keep-this-name");
    await expect(page.getByLabel("Kind")).toHaveValue("fragment");
  });

  // Hermetic: the standalone Validate button reports the same structured errors
  // WITHOUT storing — an invalid fragment needs no DB or network, and a failed
  // validate must not redirect (a successful CREATE would).
  test("the Validate button reports errors without creating", async ({ page }) => {
    await page.goto("/files/new");
    await page.getByLabel(/Name/).fill("validate-only");
    await page.getByLabel("Kind").selectOption("fragment");
    await setEditorContent(page, "id: incomplete\nfragments: []\n");
    await page.getByRole("button", { name: "Validate", exact: true }).click();

    await expect(page.getByText("FRAGMENT_FILE_SCHEMA_ERROR")).toBeVisible({ timeout: 30_000 });
    // Validate never stores, so we stay on the create page (no redirect to edit).
    await expect(page).toHaveURL(/\/files\/new$/);
  });

  // Hermetic: a quiz is NOT structurally validated (MVP stub) — Validate must
  // PASS with the "not implemented" warning and never store. No DB or network.
  test("a quiz validates with the not-implemented warning (no structural check)", async ({
    page,
  }) => {
    await page.goto("/files/new");
    await page.getByLabel(/Name/).fill("validate-quiz");
    await page.getByLabel("Kind").selectOption("quiz");
    // Deliberately minimal/structurally-unchecked content — the stub accepts it.
    await setEditorContent(page, "id: q\nquestions: []\n");
    await page.getByRole("button", { name: "Validate", exact: true }).click();

    await expect(page.getByText(/Quiz validation is not implemented yet/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/files\/new$/);
  });
});
