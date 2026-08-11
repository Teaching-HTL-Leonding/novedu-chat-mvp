import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { expect, type Page, test } from "@playwright/test";
import { extensionForImageMime } from "../lib/file-name";
import { deleteBlob, getBlobProperties, mintReadSas, mintWriteSas } from "../lib/image-blob";
import { confirmImage, getActiveImage, listImages, softDeleteImages } from "../lib/image-store";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { mintCode } from "./code.utils";

// @live-storage: the image subsystem against REAL Azure Blob Storage. These tests
// mint User-Delegation SAS URLs, PUT/GET actual blobs, and write the
// `novedu_images` metadata rows — so they need real storage credentials
// (`az login` for the data-store tenant + the storage account reachable). The
// SCCH-LLM-style geo/credential constraint means they cannot be containerized in
// fork CI, so they run LOCAL-ONLY (excluded by `npm run test:e2e:ci`, exactly like
// @live-llm). See docs/testing.md and docs/ci-security.md.
//
// Every test here also touches the database (the metadata rows), but it is tagged
// @live-storage ONLY (not @live-db): a `--grep @live-db` CI run must NOT select it,
// because it additionally needs storage no container provides.

// Load `.env` into the Playwright runner's process (the dev server and the other
// live e2e helpers do the same) so MSSQL_CONNECTION_STRING, IMAGE_STORAGE_ACCOUNT
// and the storage credentials are visible to the server seams imported below.
loadEnvConfig(process.cwd());

// A real, valid 64x64 PNG fixture — reused for the direct-to-blob PUT and the
// browser upload so both exercise actual image bytes, not a placeholder.
const RED_PNG = path.join(process.cwd(), "e2e", "fixtures", "red.png");

// =========================================================================
// (a) INTEGRATION round-trip — no browser. Drives the server seams directly:
//     mint write SAS → PUT bytes → inspect blob → confirm row → list/lookup →
//     mint read SAS → GET bytes → soft-delete → read SAS 404s + row gone.
// =========================================================================
test.describe("image storage round-trip (seams)", () => {
  test("write SAS, blob, confirm, read SAS and soft-delete all line up", {
    tag: ["@live", "@live-storage"],
  }, async ({ request }) => {
    test.skip(
      !process.env.MSSQL_CONNECTION_STRING,
      "MSSQL_CONNECTION_STRING is not set — cannot reach the image metadata table",
    );

    const userId = "e2e-test-suite";
    const name = `e2e-img-${Date.now()}`;
    const mime = "image/png" as const;
    const blobPath = `${randomUUID()}.${extensionForImageMime(mime)}`;
    const bytes = await readFile(RED_PNG);

    let confirmed = false;
    try {
      // 1) Mint a create-only write SAS and PUT the bytes STRAIGHT to the blob,
      //    exactly as the browser upload form does (BlockBlob + content type).
      const uploadUrl = await mintWriteSas(blobPath, mime);
      const put = await request.put(uploadUrl, {
        headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": mime },
        data: bytes,
      });
      expect(put.ok(), `PUT to blob failed: ${put.status()}`).toBeTruthy();

      // 2) The blob is there, with the right size and content type.
      const props = await getBlobProperties(blobPath);
      expect(props.exists).toBe(true);
      expect(props.contentLength).toBe(bytes.length);
      expect(props.contentType).toBe(mime);

      // 3) Confirm — the metadata row is created only now (with its credit).
      const stored = await confirmImage(
        { name, blobPath, mimeType: mime, byteSize: bytes.length, credit: "CC BY 4.0" },
        userId,
      );
      expect(stored).toEqual({ ok: true, name });
      confirmed = true;

      // 4) The active version is findable by name and shows up in the list.
      const active = await getActiveImage(name);
      expect(active).not.toBeNull();
      expect(active?.blobPath).toBe(blobPath);
      expect(active?.mimeType).toBe(mime);
      expect(active?.byteSize).toBe(bytes.length);
      expect(active?.credit).toBe("CC BY 4.0");

      // Unpaged (no `paging`), so this is every match, not just a first page.
      const list = await listImages({ search: name });
      expect(list?.rows.some((entry) => entry.name === name)).toBe(true);

      // 5) Mint a read SAS and GET the bytes back — same content we PUT.
      const readUrl = await mintReadSas(blobPath);
      const got = await request.get(readUrl);
      expect(got.ok(), `GET via read SAS failed: ${got.status()}`).toBeTruthy();
      expect((await got.body()).length).toBe(bytes.length);

      // 6) Bulk soft-delete (the only delete path) closes the row AND removes the
      //    blob (best-effort, in the store). The read SAS now 404s and no active
      //    version remains.
      const deleted = await softDeleteImages([name], userId);
      expect(deleted).toEqual({ ok: true, deleted: 1 });
      confirmed = false;

      const afterDelete = await request.get(readUrl);
      expect(afterDelete.status()).toBe(404);
      expect(await getActiveImage(name)).toBeNull();
    } finally {
      // Tidy up on any failure so a half-finished run leaves no stray blob/row.
      if (confirmed) await softDeleteImages([name], userId).catch(() => {});
      await deleteBlob(blobPath).catch(() => {});
    }
  });
});

// =========================================================================
// (b) BROWSER e2e — the teacher upload UI end-to-end, then the student quiz
//     display rendering a hosted image straight from Blob Storage via a real
//     read SAS. Mirrors image-attachment.spec.ts (local fixture http server for
//     the quiz YAML) + file-and-tutor-code-crud.spec.ts (teacher list CRUD).
// =========================================================================

// The quiz YAML is served from a LOCAL http server (an absolute http URL, fetched
// real by loadQuiz — it is not an app-hosted /api/files URL), so the spec is
// self-contained and references the just-uploaded hosted image by name.
let quizServer: http.Server;
let getQuizYaml: (imageName: string) => string = () => "";

test.beforeAll(async () => {
  quizServer = http.createServer((req, res) => {
    // The image name to reference rides in as `?image=<name>`.
    const url = new URL(req.url ?? "/", "http://localhost");
    const imageName = url.searchParams.get("image") ?? "";
    res.writeHead(200, { "content-type": "application/yaml" });
    res.end(getQuizYaml(imageName));
  });
  await new Promise<void>((resolve) => quizServer.listen(0, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => quizServer.close(() => resolve()));
});

// A minimal quiz whose single question references a hosted image by name. The
// question never sends an answer here (the image renders on page load, before any
// grading), so the @live-llm grader is not exercised — only the real read SAS GET.
getQuizYaml = (imageName: string) =>
  `id: e2e_image_quiz
llm:
  model: gpt-4o-mini
shuffle: false
questions:
  - id: q1
    title: Image question
    question: "What do you see in the image above?"
    evaluation: "Any answer is acceptable for this display-only e2e."
    image:
      hosted: true
      src: ${imageName}
`;

async function applyFilter(page: Page, label: string, term: string): Promise<void> {
  await page.getByLabel(label).fill(term);
  await page.getByRole("button", { name: "Apply" }).click();
}

test.describe("hosted image upload + student display", () => {
  test.use({ storageState: TEACHER_STORAGE_STATE });
  // Direct-to-blob upload + dev compile of /images and the quiz route + a real
  // SAS GET — give it room on a cold dev server.
  test.setTimeout(120_000);

  test("a teacher uploads a PNG and a student sees it in a quiz", {
    tag: ["@live", "@live-storage"],
  }, async ({ page }) => {
    test.skip(
      !process.env.MSSQL_CONNECTION_STRING,
      "MSSQL_CONNECTION_STRING is not set — cannot reach the image metadata table",
    );

    const imageName = `e2e-disp-${Date.now()}`;
    let uploaded = false;

    try {
      // TEACHER — upload the PNG straight to Blob Storage via the form (the form
      // mints a create-only SAS, PUTs the bytes, then confirms the metadata row).
      await page.goto("/images/new");
      await page.getByLabel(/Name/).fill(imageName);
      await page.locator('input[type="file"]').setInputFiles(RED_PNG);
      await page.getByRole("button", { name: "Upload image" }).click();

      // On success the form lands back on /images, where the new row + its "View"
      // action (which opens the read-SAS image in the shared lightbox) appear.
      await expect(page).toHaveURL(/\/images$/, { timeout: 60_000 });
      uploaded = true;
      await applyFilter(page, "Filter images", imageName);
      const row = page.getByRole("row").filter({ hasText: imageName });
      await expect(row).toHaveCount(1);
      // The row exposes a "View" action (no inline thumbnail); clicking it opens the
      // shared <ImageLightbox> with the uploaded image full-window.
      await row.getByRole("button", { name: `View image ${imageName}` }).click();
      const lightboxImg = page.getByRole("img", { name: imageName });
      await expect(lightboxImg).toBeVisible();
      // It really loaded from Blob Storage (decoded, non-zero pixels; no fallback note).
      await expect(page.getByText("Image could not be loaded")).toHaveCount(0);
      await expect
        .poll(() => lightboxImg.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
      // Close the lightbox before moving on to the student view.
      await page.getByRole("button", { name: "Close" }).click();

      // STUDENT — open a quiz code whose only question references the hosted image
      // by name. The page resolves it to a read SAS server-side; the runner renders
      // it via <ContentImage>, which fetches the bytes direct from Blob Storage.
      const quizUrl = `http://127.0.0.1:${
        (quizServer.address() as AddressInfo).port
      }/quiz.yaml?image=${imageName}`;
      const code = await mintCode({ module: "quiz", file: quizUrl });

      await page.goto(`/${code}`);
      // The quiz question's image is the thumbnail button inside <ContentImage>.
      const viewLarger = page.getByRole("button", { name: "View larger image" });
      await expect(viewLarger).toBeVisible({ timeout: 60_000 });
      // It decoded from the real SAS GET (the fallback note never showed).
      await expect(page.getByText("Image could not be loaded")).toHaveCount(0);
      await expect
        .poll(() => viewLarger.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);

      // The lightbox opens (a native <dialog> showing the same image full-window).
      await viewLarger.click();
      await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    } finally {
      // CLEAN UP — delete the image (drops the row + its backing blob) via the list's
      // "Delete Selected" multi-delete (the only delete affordance the list exposes).
      if (uploaded) {
        try {
          await page.goto("/images");
          await applyFilter(page, "Filter images", imageName);
          if ((await page.getByRole("row").filter({ hasText: imageName }).count()) > 0) {
            await page.getByRole("checkbox", { name: `Select ${imageName}` }).check();
            page.once("dialog", (dialog) => dialog.accept());
            await page.getByRole("button", { name: /Delete .*selected/i }).click();
            await expect(page.getByRole("row").filter({ hasText: imageName })).toHaveCount(0);
          }
        } catch {
          // best-effort
        }
      }
    }
  });
});
