import { expect, type Page, test } from "@playwright/test";
import { unixSecondsToDatetimeLocal } from "../lib/datetime-local";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { VALID_TUTOR_URL } from "./code.utils";

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

// Remove a single list row via the shared "Delete Selected" multi-delete — the only
// delete affordance the codes/files/images lists expose (per-row delete lives on the
// edit page now). Filters to the row, ticks it, confirms. The filter term doubles as
// the checkbox's accessible-name suffix ("Select <term>").
async function bulkDeleteRow(
  page: Page,
  listPath: string,
  filterLabel: string,
  term: string,
): Promise<void> {
  await page.goto(listPath);
  await applyFilter(page, filterLabel, term);
  if ((await page.getByRole("row").filter({ hasText: term }).count()) === 0) return;
  await page.getByRole("checkbox", { name: `Select ${term}` }).check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Delete .*selected/i }).click();
  await expect(page.getByRole("row").filter({ hasText: term })).toHaveCount(0);
}

// Best-effort cleanup so a mid-test failure does not leave strays in the shared
// dev database (the file's filtered-unique index would otherwise reject a re-run).
let createdFileName: string | null = null;
let createdCodeLabel: string | null = null;
// Extra files the multi-delete test creates; tidied here too so a mid-test failure
// still leaves no strays.
const createdFileNames: string[] = [];

test.afterEach(async ({ page }) => {
  if (createdFileName) {
    const name = createdFileName;
    createdFileName = null;
    try {
      await bulkDeleteRow(page, "/files", "Filter files", name);
    } catch {
      // best-effort
    }
  }
  while (createdFileNames.length > 0) {
    const name = createdFileNames.pop() as string;
    try {
      await bulkDeleteRow(page, "/files", "Filter files", name);
    } catch {
      // best-effort
    }
  }
  if (createdCodeLabel) {
    const label = createdCodeLabel;
    createdCodeLabel = null;
    try {
      await bulkDeleteRow(page, "/codes", "Filter codes", label);
    } catch {
      // best-effort
    }
  }
});

test("CRUD on a hosted file and a tutor link, with DB-side filtering", {
  tag: ["@live", "@live-db"],
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

  // FILE — delete (via the list's "Delete Selected" — the only delete path now).
  await bulkDeleteRow(page, "/files", "Filter files", fileName);
  createdFileName = null;
  expect((await page.request.get(fileUrl)).status()).toBe(404);

  // =========================================================================
  // TUTOR LINK — create (sharing the canonical simple tutor YAML)
  // =========================================================================
  const note = `e2e tutor link ${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  await page.goto("/codes/new");
  await page.getByLabel("Activity YAML URL").fill(VALID_TUTOR_URL);
  await page.getByLabel(/Note/).fill(note);
  await page.getByLabel(/Available from/).fill(unixSecondsToDatetimeLocal(now - 3600));
  await page.getByLabel(/Available until/).fill(unixSecondsToDatetimeLocal(now + 3600));
  createdCodeLabel = note;
  await page.getByRole("button", { name: "Create code" }).click();

  // Lands on the new code's edit page, which shows the shareable chat URL.
  await expect(page).toHaveURL(/\/codes\/edit\/[a-z0-9]{10}$/, { timeout: 60_000 });
  const link = page.getByLabel("Share link", { exact: true });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const linkValue = await link.inputValue();
  expect(linkValue).toMatch(/^http:\/\/localhost:3000\/[a-z0-9]{10}$/);

  // TUTOR LINK — stats detail: opening /codes/<code> renders ConversationStats,
  // which runs getCodeStats' RAW SQL (the `LEFT JOIN novedu_users` + `GROUP BY
  // un.display_name` added for name resolution — untyped, so unit tests can't catch
  // a malformed query). A freshly created code has no conversations, so the page
  // must show the empty state — NOT the "stats temporarily unavailable" notice that
  // getCodeStats returns when the query throws — which proves the join is valid SQL.
  const codeId = linkValue.split("/").pop() as string;
  await page.goto(`/codes/${codeId}`);
  await expect(
    page.getByText(/a conversation counts once a student sends at least one message/i),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Stats temporarily unavailable/i)).toHaveCount(0);

  // TUTOR LINK — update: change the note (the URL field is read-only).
  await page.goto(`/codes/edit/${codeId}`);
  await expect(page.getByLabel(/Activity YAML URL/)).toHaveAttribute("readonly", "");
  const editedNote = `${note} edited`;
  await page.getByLabel(/Note/).fill(editedNote);
  createdCodeLabel = editedNote;
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 30_000 });

  // TUTOR LINK — read: the edited note is findable via the DB-side filter.
  await page.goto("/codes");
  await applyFilter(page, "Filter codes", editedNote);
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page.getByRole("row").filter({ hasText: editedNote })).toHaveCount(1);

  // TUTOR LINK — open: the chat opens within the window.
  await page.goto(linkValue);
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 60_000 });

  // TUTOR LINK — delete (via the shared "Delete Selected" multi-delete; the codes
  // list has no per-row delete button — see app/codes/page.tsx).
  await page.goto("/codes");
  await applyFilter(page, "Filter codes", editedNote);
  const codeRow = page.getByRole("row").filter({ hasText: editedNote });
  await expect(codeRow).toHaveCount(1);
  await page.getByRole("checkbox", { name: `Select ${editedNote}` }).check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Delete .*selected/i }).click();
  await expect(page.getByRole("row").filter({ hasText: editedNote })).toHaveCount(0, {
    timeout: 30_000,
  });
  createdCodeLabel = null;
});

// CODING CODE — the per-module result seam: creating a CODING code lands on the same
// edit screen as any other, but its result body is the little-coder connection config
// (`CodingResult` → `CodingConnection`), NOT the `/<code>` share link — a coding code
// is an API key, not a web link. The URL field accepts any reachable URL here because
// coding's authoring validation is a placeholder, and the result display is independent
// of the YAML's contents.
test("creating a coding code shows the little-coder config instead of the share link", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  const note = `e2e coding ${Date.now()}`;
  await page.goto("/codes/new");
  await page.getByLabel("Activity", { exact: true }).selectOption("coding");
  await page.getByLabel("Activity YAML URL").fill(VALID_TUTOR_URL);
  await page.getByLabel(/Note/).fill(note);
  createdCodeLabel = note;
  await page.getByRole("button", { name: "Create code" }).click();

  // Lands on the new code's edit screen.
  await expect(page).toHaveURL(/\/codes\/edit\/[a-z0-9]{10}$/, { timeout: 60_000 });

  // The little-coder connection config is shown (base URL + models.json snippet)…
  await expect(page.getByRole("button", { name: "Copy base URL" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Copy models.json" })).toBeVisible();
  // …and the share-link box is NOT (coding replaces it, per the user's "instead").
  await expect(page.getByLabel("Share link", { exact: true })).toHaveCount(0);
});

// The shared multi-delete layer end-to-end: tick several rows and remove them all
// in ONE "Delete Selected" action (the same store delete each row's trash button
// runs). Files only — no LLM — so it runs in CI against the SQL container.
test("multi-select Delete Selected removes every chosen file in one action", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  const stamp = Date.now();
  const prefix = `e2e-multi-${stamp}`;
  const names = [`${prefix}-a`, `${prefix}-b`];
  const fragmentYaml = (id: string) =>
    `id: ${id}\nfragments:\n  - id: greeting\n    version: 1\n    priority: 1\n    content: "Hi"\n`;

  // Create two hosted fragment files (distinct YAML ids).
  for (const [i, name] of names.entries()) {
    await page.goto("/files/new");
    await page.getByLabel(/Name/).fill(name);
    await page.getByLabel("Kind").selectOption("fragment");
    await setEditorContent(page, fragmentYaml(`e2e_multi_${stamp}_${i}`));
    createdFileNames.push(name);
    await page.getByRole("button", { name: "Validate & create" }).click();
    await expect(page).toHaveURL(new RegExp(`/files/edit/${name}$`), { timeout: 30_000 });
  }

  // Both are listed under the shared prefix.
  await page.goto("/files");
  await applyFilter(page, "Filter files", prefix);
  for (const name of names) {
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(1);
  }

  // "Delete Selected" is disabled until something is selected.
  const deleteSelected = page.getByRole("button", { name: /Delete .*selected/i });
  await expect(deleteSelected).toBeDisabled();

  // Tick the two specific rows, then delete them both in ONE action.
  for (const name of names) {
    await page.getByRole("checkbox", { name: `Select ${name}` }).check();
  }
  await expect(deleteSelected).toBeEnabled();
  // Capture + accept the confirm unconditionally (asserting inside the handler can
  // leave the dialog unhandled and hang the click); check the count afterwards.
  let dialogMessage = "";
  page.once("dialog", (dialog) => {
    dialogMessage = dialog.message();
    dialog.accept();
  });
  await deleteSelected.click();

  // Both rows are gone and neither file is served any more.
  for (const name of names) {
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0, {
      timeout: 30_000,
    });
    expect((await page.request.get(`/api/files/${name}`)).status()).toBe(404);
  }
  expect(dialogMessage).toContain("2 files");
  createdFileNames.length = 0; // all deleted; nothing for afterEach to tidy
});
