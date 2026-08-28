import { expect, type Page, test } from "@playwright/test";

// The support page students are pointed at when a photo does not work
// (app/image-check). Hermetic: it never calls the server after the page loads —
// the file is decoded, measured and re-encoded in the browser — so the whole
// feature is exercisable with no DB, no LLM and no fixtures. Files are built in
// the page itself rather than committed as binaries.

/** A photo to be drawn with a canvas, so an oversized one costs no repo bytes. */
interface DrawnFile {
  kind: "drawn";
  width: number;
  height: number;
  type: "image/png" | "image/jpeg";
  name: string;
}

/** A photo supplied as literal bytes, for the cases whose whole point IS the bytes. */
interface RawFile {
  kind: "raw";
  bytes: number[];
  type: string;
  name: string;
}

/**
 * Hands the page ONE pick containing every file, the way a student selecting
 * several photos at once does. A single DataTransfer is the point: the per-file
 * report sections only exist for a multi-file pick.
 */
async function pickFiles(page: Page, files: (DrawnFile | RawFile)[]): Promise<void> {
  await page.evaluate(async (specs) => {
    const transfer = new DataTransfer();
    for (const spec of specs) {
      if (spec.kind === "raw") {
        transfer.items.add(new File([new Uint8Array(spec.bytes)], spec.name, { type: spec.type }));
        continue;
      }
      const canvas = document.createElement("canvas");
      canvas.width = spec.width;
      canvas.height = spec.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, spec.width, spec.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, spec.type));
      if (!blob) throw new Error("toBlob failed");
      transfer.items.add(new File([blob], spec.name, { type: spec.type }));
    }
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input not rendered");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, files);
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // It is a normal app page, covered by the default-deny matcher in proxy.ts —
  // there is deliberately NO exclusion for it and no new public surface.
  test("the photo check page requires sign-in like every other page", async ({ page }) => {
    await page.goto("/image-check");

    await expect(page).toHaveURL(/\/api\/auth\/signin/);
  });
});

// ONE pick of three photos that fail three different ways, because the page's
// unique job is the WIRING — normalize → diagnose → render one numbered section
// per file — and only a multi-file pick exercises it. The verdicts themselves
// (the 2000px cap, the byte sniffer, the HEIC naming) are pinned per-branch and
// without a browser round-trip in lib/image-normalize.browser.test.tsx, and the
// report's wording and redaction in lib/image-report.unit.test.ts. Restating
// them here would only re-prove them more slowly.
test("reports every photo of a multi-file pick, each with its own verdict", async ({ page }) => {
  await page.goto("/image-check");
  await expect(page.getByRole("heading", { name: "Photo check" })).toBeVisible();

  // A real HEIC header: `ftypheic` at offset 4. No non-Apple browser decodes
  // one, so the actionable part is that the page NAMES the format.
  const heicHeader = [0, 0, 0, 0x18, ...Array.from("ftypheic", (c) => c.charCodeAt(0))];

  await pickFiles(page, [
    // Oversized but valid → accepted after a resize.
    { kind: "drawn", width: 4000, height: 3000, type: "image/jpeg", name: "IMG_1234.jpg" },
    // Claims to be a PNG; is not. The sniffer is what makes the verdict honest.
    {
      kind: "raw",
      name: "homework.png",
      type: "image/png",
      bytes: Array.from("this is not a picture", (c) => c.charCodeAt(0)),
    },
    {
      kind: "raw",
      name: "IMG_0042.heic",
      type: "image/heic",
      bytes: [...heicHeader, ...Array(64).fill(0)],
    },
  ]);

  // Both verdicts are on screen at once — the page does not stop at the first
  // failure, which is the behavior that makes a multi-photo pick worth taking.
  await expect(page.getByText("ACCEPTED:").first()).toBeVisible();
  await expect(page.getByText("REJECTED:").first()).toBeVisible();
  // The cap applies to the longest edge and the aspect ratio survives it.
  await expect(page.getByText("2000 × 1500")).toBeVisible();

  // The report is what the student actually sends on: one numbered section per
  // picked file, carrying the facts that separate one failure from another.
  const report = page.locator("pre");
  await expect(report).toContainText("file 1");
  await expect(report).toContainText("file 2");
  await expect(report).toContainText("file 3");
  await expect(report).toContainText("4000x3000");
  await expect(report).toContainText("maxEdge=2000");
  await expect(report).toContainText("MISMATCH");
  await expect(report).toContainText("heif");
  // Content-free: the extension travels, the filename never does.
  await expect(report).toContainText(".jpg");
  await expect(report).not.toContainText("IMG_1234");
  await expect(report).not.toContainText("IMG_0042");
});
