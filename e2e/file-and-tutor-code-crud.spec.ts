import { expect, type Page, test } from "@playwright/test";
import { unixSecondsToDatetimeLocal } from "../lib/datetime-local";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { VALID_TUTOR_URL } from "./tutor-code.utils";

// @live end-to-end CRUD over BOTH a hosted YAML file and a tutor link ("tutor
// code"), as a teacher, against the real database (the dev server authenticates
// with the local `az login` identity). Writes real rows, so it is excluded from
// CI like the other live specs. The tutor link shares the canonical simple
// tutor YAML (VALID_TUTOR_URL → .../tutors/simple-tutor.yaml). Covers the
// DB-side filtering (Apply → ?q=) on both list pages.

test.use({ storageState: TEACHER_STORAGE_STATE });
// Dev compilation of the routes + GitHub fetch of the tutor YAML + DB round-trips.
test.setTimeout(120_000);

const FRAGMENT_V1 = `id: e2e_crud_fragments
fragments:
  - id: greeting
    version: 1
    priority: 1
    content: "Hello from version one"
`;
const FRAGMENT_V2 = `id: e2e_crud_fragments
fragments:
  - id: greeting
    version: 2
    priority: 1
    content: "Hello from version two"
`;

// Replace the CodeMirror document with `text` (insertText pastes verbatim so YAML
// indentation survives).
async function setEditorContent(page: Page, text: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

async function applyFilter(page: Page, label: string, term: string): Promise<void> {
  await page.getByLabel(label).fill(term);
  await page.getByRole("button", { name: "Apply" }).click();
}

// Best-effort cleanup so a mid-test failure does not leave strays in the shared
// dev database (the file's filtered-unique index would otherwise reject a re-run).
let createdFileName: string | null = null;
let createdCodeLabel: string | null = null;

test.afterEach(async ({ page }) => {
  if (createdFileName) {
    const name = createdFileName;
    createdFileName = null;
    try {
      await applyFilter(page, "Filter files", name);
      const row = page.getByRole("row").filter({ hasText: name });
      if ((await row.count()) > 0) {
        page.once("dialog", (dialog) => dialog.accept());
        await row.getByRole("button", { name: `Delete file ${name}` }).click();
        await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
      }
    } catch {
      // best-effort
    }
  }
  if (createdCodeLabel) {
    const label = createdCodeLabel;
    createdCodeLabel = null;
    try {
      await applyFilter(page, "Filter tutor codes", label);
      const row = page.getByRole("row").filter({ hasText: label });
      if ((await row.count()) > 0) {
        page.once("dialog", (dialog) => dialog.accept());
        await row.getByRole("button", { name: `Delete tutor code ${label}` }).click();
        await expect(page.getByRole("row").filter({ hasText: label })).toHaveCount(0);
      }
    } catch {
      // best-effort
    }
  }
});

test("CRUD on a hosted file and a tutor link, with DB-side filtering", {
  tag: "@live",
}, async ({ page }) => {
  // =========================================================================
  // FILE — create
  // =========================================================================
  const fileName = `e2e-crud-${Date.now()}`;
  const fileUrl = `/api/files/${fileName}`;
  await page.goto("/files/new");
  await page.getByLabel(/Name/).fill(fileName);
  await page.getByLabel("Kind").selectOption("fragment");
  await setEditorContent(page, FRAGMENT_V1);
  createdFileName = fileName;
  await page.getByRole("button", { name: "Validate & create" }).click();
  await expect(page).toHaveURL(new RegExp(`/files/edit/${fileName}$`), { timeout: 30_000 });

  // FILE — read: it is in the list and filterable IN THE DB (Apply → ?q=).
  await page.goto("/files");
  await applyFilter(page, "Filter files", fileName);
  await expect(page).toHaveURL(/[?&]q=/);
  const fileRow = page.getByRole("row").filter({ hasText: fileName });
  await expect(fileRow).toHaveCount(1);
  await expect(fileRow.getByText("fragment")).toBeVisible();

  // A non-matching filter returns nothing.
  await applyFilter(page, "Filter files", "no-such-file-xyz");
  await expect(page.getByText("No files match your filter.")).toBeVisible();

  // FILE — update: edit to v2, the public GET then serves v2.
  await applyFilter(page, "Filter files", fileName);
  await page
    .getByRole("row")
    .filter({ hasText: fileName })
    .getByRole("link", { name: `Edit ${fileName}` })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Hello from version one");
  await setEditorContent(page, FRAGMENT_V2);
  await page.getByRole("button", { name: "Validate & save" }).click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 30_000 });
  const fileRes = await page.request.get(fileUrl);
  expect(await fileRes.text()).toContain("Hello from version two");

  // FILE — delete (from the edit page).
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Delete file ${fileName}` }).click();
  await expect(page).toHaveURL(/\/files$/, { timeout: 30_000 });
  createdFileName = null;
  expect((await page.request.get(fileUrl)).status()).toBe(404);

  // =========================================================================
  // TUTOR LINK — create (sharing the canonical simple tutor YAML)
  // =========================================================================
  const note = `e2e tutor link ${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  await page.goto("/tutor-codes/new");
  await page.getByLabel("Tutor YAML URL").fill(VALID_TUTOR_URL);
  await page.getByLabel(/Note/).fill(note);
  await page.getByLabel(/Available from/).fill(unixSecondsToDatetimeLocal(now - 3600));
  await page.getByLabel(/Available until/).fill(unixSecondsToDatetimeLocal(now + 3600));
  createdCodeLabel = note;
  await page.getByRole("button", { name: "Create Tutor Code" }).click();

  // Lands on the new code's edit page, which shows the shareable chat URL.
  await expect(page).toHaveURL(/\/tutor-codes\/edit\/[a-z0-9]{10}$/, { timeout: 60_000 });
  const link = page.getByLabel("Tutor Code link", { exact: true });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const linkValue = await link.inputValue();
  expect(linkValue).toMatch(/^http:\/\/localhost:3000\/[a-z0-9]{10}$/);

  // TUTOR LINK — update: change the note (the URL field is read-only).
  await expect(page.getByLabel(/Tutor YAML URL/)).toHaveAttribute("readonly", "");
  const editedNote = `${note} edited`;
  await page.getByLabel(/Note/).fill(editedNote);
  createdCodeLabel = editedNote;
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 30_000 });

  // TUTOR LINK — read: the edited note is findable via the DB-side filter.
  await page.goto("/tutor-codes");
  await applyFilter(page, "Filter tutor codes", editedNote);
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page.getByRole("row").filter({ hasText: editedNote })).toHaveCount(1);

  // TUTOR LINK — open: the chat opens within the window.
  await page.goto(linkValue);
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 60_000 });

  // TUTOR LINK — delete (from the list row).
  await page.goto("/tutor-codes");
  await applyFilter(page, "Filter tutor codes", editedNote);
  const codeRow = page.getByRole("row").filter({ hasText: editedNote });
  await expect(codeRow).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await codeRow.getByRole("button", { name: `Delete tutor code ${editedNote}` }).click();
  await expect(page.getByRole("row").filter({ hasText: editedNote })).toHaveCount(0);
  createdCodeLabel = null;
});
