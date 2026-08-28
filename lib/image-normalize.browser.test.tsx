import { expect, test } from "vitest";
import { normalizeStudentImage } from "@/lib/image-normalize";

// The half of the normalizer that only a REAL browser can prove: decoding,
// EXIF being baked into the decode, the downscale, the alpha flattening and the
// JPEG re-encode. Runs in Playwright Chromium (docs/testing.md) against canvas-
// built files, so it needs no fixture binaries and no network.
//
// CROSS-ENGINE NOTE: this project runs component tests in Chromium only. The
// orientation behaviour asserted below was separately verified to be identical
// in Chromium, Firefox and WebKit — including that `imageOrientation: "none"` is
// ignored, which is why the normalizer does not bother passing the option and
// relies on the plain <img> decode instead.

/** A canvas-built file, so every test owns its own bytes. */
async function makeFile(
  name: string,
  type: "image/png" | "image/jpeg",
  width: number,
  height: number,
  paint?: (ctx: CanvasRenderingContext2D) => void,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  // Noise keeps the JPEG encoder from producing a degenerate near-empty file.
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, width, height);
  paint?.(ctx);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.9 : undefined),
  );
  if (!blob) throw new Error("toBlob failed");
  return new File([blob], name, { type });
}

/** Splices an APP1/Exif segment carrying one `Orientation` tag into a JPEG. */
async function withOrientation(file: File, orientation: number): Promise<File> {
  const original = new Uint8Array(await file.arrayBuffer());
  const tiff = [
    0x49,
    0x49,
    42,
    0, // "II", 42 little-endian
    8,
    0,
    0,
    0, // IFD0 at offset 8
    1,
    0, // one entry
    0x12,
    0x01,
    3,
    0,
    1,
    0,
    0,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
    0, // no next IFD
  ];
  const payload = [...[..."Exif\0\0"].map((c) => c.charCodeAt(0)), ...tiff];
  const app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  const out = new Uint8Array(original.length + app1.length);
  out.set(original.slice(0, 2), 0);
  out.set(app1, 2);
  out.set(original.slice(2), 2 + app1.length);
  return new File([out], file.name, { type: "image/jpeg" });
}

/** Reads one pixel back out of a produced data URL. */
async function pixelAt(dataUrl: string, x: number, y: number): Promise<[number, number, number]> {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(x, y, 1, 1).data;
  return [data[0] as number, data[1] as number, data[2] as number];
}

// A resize means a photo, and a photo means JPEG — the lossless branch above is
// only for images that needed nothing but flattening.
test("caps the longest edge, keeps the aspect ratio, and re-encodes as JPEG", async () => {
  const file = await makeFile("wide.png", "image/png", 1200, 300);
  const result = await normalizeStudentImage(file, { maxEdge: 600 });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.mimeType).toBe("image/jpeg");
  expect(result.diagnostics.passedThrough).toBe(false);
  expect(result.diagnostics.outputWidth).toBe(600);
  expect(result.diagnostics.outputHeight).toBe(150);
});

// The bug this guards: a transparent PNG composites onto a fresh canvas as
// BLACK, and JPEG has no alpha to rescue it — dark-on-dark homework nothing can
// read. The normalizer paints white first.
test("flattens transparency onto white, not black", async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 40;
  canvas.height = 40;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  // Fully transparent everywhere except a small opaque mark.
  ctx.clearRect(0, 0, 40, 40);
  ctx.fillStyle = "#000000";
  ctx.fillRect(30, 30, 5, 5);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("toBlob failed");
  const file = new File([blob], "transparent.png", { type: "image/png" });

  const result = await normalizeStudentImage(file, { maxEdge: 20 });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const [r, g, b] = await pixelAt(result.dataUrl, 2, 2);
  expect(r).toBeGreaterThan(240);
  expect(g).toBeGreaterThan(240);
  expect(b).toBeGreaterThan(240);
});

test("passes an already-fine JPEG through untouched", async () => {
  const file = await makeFile("small.jpg", "image/jpeg", 300, 200);
  const result = await normalizeStudentImage(file, { maxEdge: 2000 });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.diagnostics.passedThrough).toBe(true);
  expect(result.mimeType).toBe("image/jpeg");
  expect(result.diagnostics.outputBytes).toBe(file.size);
  expect(result.diagnostics.outputWidth).toBe(300);
});

// A canvas always writes RGBA, so this PNG CAN carry transparency and must not
// pass through: the server-side decoder drops the alpha channel without
// compositing, so transparent pixels would arrive black. It is flattened — but
// stays a lossless PNG, because nothing about it needed resizing and putting a
// screenshot of text through a JPEG encoder is what the pass-through rule exists
// to avoid.
test("flattens a PNG that could carry alpha, but keeps it lossless", async () => {
  const file = await makeFile("shot.png", "image/png", 300, 200);
  const result = await normalizeStudentImage(file, { maxEdge: 2000 });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.diagnostics.passedThrough).toBe(false);
  expect(result.mimeType).toBe("image/png");
  expect(result.diagnostics.outputWidth).toBe(300);
  expect(result.diagnostics.outputHeight).toBe(200);
});

// The reason pass-through is conditional on orientation: the browser bakes the
// rotation into ITS decode, but a passed-through file still carries the tag, and
// the server-side decoder that reads it (PIL) ignores EXIF entirely — the photo
// would reach the model sideways.
test("re-encodes a small photo that carries a rotation tag", async () => {
  const plain = await makeFile("rotated.jpg", "image/jpeg", 40, 20);
  const file = await withOrientation(plain, 6);
  const result = await normalizeStudentImage(file, { maxEdge: 2000 });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.diagnostics.exifOrientation).toBe(6);
  expect(result.diagnostics.passedThrough).toBe(false);
  // Orientation 6 is a quarter turn: the decode reports the SWAPPED dimensions,
  // and the output keeps them — so the pixels are upright with no tag left.
  expect(result.diagnostics.decodedWidth).toBe(20);
  expect(result.diagnostics.decodedHeight).toBe(40);
  expect(result.diagnostics.outputWidth).toBe(20);
  expect(result.diagnostics.outputHeight).toBe(40);
});

test("reports a HEIC no browser could open as such, by its bytes", async () => {
  const header = [0, 0, 0, 0x18, ...[..."ftypheic"].map((c) => c.charCodeAt(0))];
  // A real HEIC fails identically in Chromium; the brand is what makes the
  // message actionable, and it is all the sniffer needs.
  const file = new File([new Uint8Array([...header, ...new Array(64).fill(0)])], "IMG_0042.heic", {
    type: "image/heic",
  });
  const result = await normalizeStudentImage(file);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe("heif-undecodable");
  expect(result.diagnostics.sniffedContainer).toBe("heif");
  expect(result.message).toContain("HEIC");
});

test("rejects something that is not an image at all", async () => {
  const file = new File(["this is not a picture"], "notes.txt", { type: "image/jpeg" });
  const result = await normalizeStudentImage(file);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe("undecodable");
  expect(result.diagnostics.sniffedContainer).toBe("unknown");
});

// The pick ceiling exists so a phone browser never tries to decode a file that
// would blow its memory; it is checked before any bytes are read.
test("refuses an oversized pick before decoding it", async () => {
  const file = await makeFile("big.jpg", "image/jpeg", 100, 100);
  const result = await normalizeStudentImage(file, { maxRawBytes: 10 });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe("raw-too-large");
  expect(result.diagnostics.decodedWidth).toBeUndefined();
});

test("re-encodes rather than passing through when the file exceeds the send cap", async () => {
  const file = await makeFile("dense.png", "image/png", 400, 400, (ctx) => {
    for (let i = 0; i < 400; i += 2) {
      ctx.fillStyle = i % 4 === 0 ? "#ff0000" : "#00ff00";
      ctx.fillRect(i, 0, 2, 400);
    }
  });
  const result = await normalizeStudentImage(file, { maxEdge: 2000, maxOutputBytes: 1024 });
  // Either it compressed under the cap or it reported that it could not — never
  // a silent pass-through of something over the limit.
  if (result.ok) {
    expect(result.diagnostics.passedThrough).toBe(false);
    expect(result.diagnostics.outputBytes ?? 0).toBeLessThanOrEqual(1024);
  } else {
    expect(result.reason).toBe("too-large");
  }
});
