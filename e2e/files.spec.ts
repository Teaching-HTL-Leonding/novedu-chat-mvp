import { expect, type Page, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// End-to-end coverage for the YAML File hosting feature. The authorization gate
// is hermetic (runs in CI); the full create → list → update → delete cycle is
// `@live` because it writes to the real database (the dev server authenticates
// with the local `az login` identity) — excluded from CI like the other live
// specs.

// A minimal, self-contained FRAGMENT library. Validation of a fragment file
// needs no network (it has no fragment_files to fetch), so the save path stays
// fast and deterministic — no GitHub round-trip.
const FRAGMENT_V1 = `id: e2e_files_fragments
fragments:
  - id: greeting
    version: 1
    priority: 1
    content: "Hello from version one"
`;
const FRAGMENT_V2 = `id: e2e_files_fragments
fragments:
  - id: greeting
    version: 2
    priority: 1
    content: "Hello from version two"
`;

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
  // Dev compilation of the new routes + DB round-trips.
  test.setTimeout(90_000);

  // Best-effort cleanup: the @live test soft-deletes its file on the happy path,
  // but if it fails earlier the active row would linger — and the filtered
  // unique index would then reject a same-name re-run while the shared dev list
  // accumulates strays. A test sets `liveFileName` once it has created a file.
  let liveFileName: string | null = null;
  test.afterEach(async ({ page }) => {
    if (!liveFileName) return;
    const name = liveFileName;
    liveFileName = null;
    try {
      await page.goto("/files");
      const row = page.getByRole("row").filter({ hasText: name });
      if ((await row.count()) > 0) {
        page.once("dialog", (dialog) => dialog.accept());
        await row.getByRole("button", { name: `Delete file ${name}` }).click();
        await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
      }
    } catch {
      // Cleanup is best-effort — never fail the suite on it.
    }
  });

  // Hermetic: a fragment with invalid YAML fails validation locally (no DB, no
  // network), so this verifies the create form keeps the entered name and kind
  // when the save is rejected — React resets uncontrolled form fields after an
  // action, so they must be controlled.
  test("a rejected create keeps the entered name and kind", async ({ page }) => {
    await page.goto("/files/new");
    await page.getByLabel(/Name/).fill("keep-this-name");
    await page.getByLabel("Kind").selectOption("fragment");
    await setEditorContent(page, "id: incomplete\nfragments: []\n");
    await page.getByRole("button", { name: "Create file" }).click();

    // The detailed validator errors are shown (not just a generic message)…
    await expect(page.getByRole("heading", { name: /Validation failed/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("FRAGMENT_FILE_SCHEMA_ERROR")).toBeVisible();
    // …and the entered name and kind are preserved across the rejected submit.
    await expect(page.getByLabel(/Name/)).toHaveValue("keep-this-name");
    await expect(page.getByLabel("Kind")).toHaveValue("fragment");
  });

  // @live: the whole lifecycle against the real database.
  test("create (via CodeMirror) → list → update → soft-delete a hosted file", {
    tag: "@live",
  }, async ({ page }) => {
    const name = `e2e-file-${Date.now()}`;
    const fileUrl = `/api/files/${name}`;

    // --- CREATE ---
    await page.goto("/files/new");
    await page.getByLabel(/Name/).fill(name);
    await page.getByLabel("Kind").selectOption("fragment");
    await setEditorContent(page, FRAGMENT_V1);
    // From here a row may exist — register it for best-effort afterEach cleanup.
    liveFileName = name;
    await page.getByRole("button", { name: "Create file" }).click();

    // A valid create redirects to the file's edit page, preloaded with v1.
    await expect(page).toHaveURL(new RegExp(`/files/edit/${name}$`), { timeout: 30_000 });
    await expect(page.locator(".cm-content")).toContainText("Hello from version one");

    // It appears in the list…
    await page.goto("/files");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("fragment")).toBeVisible();

    // …and is filterable (contains-search over the name).
    await page.getByLabel("Filter files").fill(name);
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(1);
    await page.getByLabel("Filter files").fill("no-such-file-xyz");
    await expect(page.getByText("No files match your filter.")).toBeVisible();
    await page.getByLabel("Filter files").fill("");

    // The public GET endpoint serves version one.
    const res1 = await page.request.get(fileUrl);
    expect(res1.ok()).toBeTruthy();
    expect(res1.headers()["content-type"]).toContain("text/yaml");
    expect(await res1.text()).toContain("Hello from version one");

    // --- UPDATE ---
    await row.getByRole("link", { name: `Edit ${name}` }).click();
    await expect(page.locator(".cm-content")).toContainText("Hello from version one");
    await setEditorContent(page, FRAGMENT_V2);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 30_000 });

    // The GET endpoint now serves version two (latest, no caching).
    const res2 = await page.request.get(fileUrl);
    expect(await res2.text()).toContain("Hello from version two");

    // --- SOFT-DELETE (from the edit page) ---
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `Delete file ${name}` }).click();

    // Returns to the list, where the file is gone…
    await expect(page).toHaveURL(/\/files$/, { timeout: 30_000 });
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);

    // …and the GET endpoint 404s (deleted files cannot be fetched).
    const res3 = await page.request.get(fileUrl);
    expect(res3.status()).toBe(404);
  });
});
