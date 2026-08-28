// Normalizing student-supplied photos IN THE BROWSER, before they are ever
// base64-inlined into a model request. BROWSER-ONLY (`Image`, `canvas`,
// `FileReader`) — deliberately NOT in `lib/answer-images.ts`, whose
// `validateAnswerImages` is imported by the `"use server"` module
// `lib/quiz-actions.ts`: DOM code there would ride into the server-action
// module graph. That file keeps the constants + the server-authoritative
// validator; everything that touches the DOM lives here.
//
// WHY THIS EXISTS (GitHub #26 — "Analyze image failed"). A phone camera hands
// the picker a file the rest of the pipeline was never sized for:
//
//   - 24.5 MP (5712x4284 is the iPhone default) — ~3 MB of JPEG becomes ~4 MB of
//     base64 inside the chat-completions body, and the image is REPLAYED from
//     Mastra memory on every following turn of the same thread.
//   - EXIF `Orientation`: every browser applies it when decoding (verified in
//     Chromium / Firefox / WebKit — even `imageOrientation: "none"` is ignored,
//     the option is deprecated), but PIL's `Image.open` — what a vLLM server
//     uses — does NOT. So a photo the student sees upright can reach the model
//     rotated 90 degrees, which destroys OCR of a textbook page.
//   - HEIC: an iPhone photo-library pick through `accept="image/*"` is
//     transcoded to JPEG by Safari, but a pick through the Files app is not.
//     Stock Pillow cannot open HEIC at all (no `pillow-heif`), so those bytes
//     can only ever 400 upstream.
//
// Decoding through the browser and re-encoding as JPEG fixes all three at once,
// and strips EXIF (including GPS) from a photo taken at a student's home as a
// side effect. See `docs/chat.md`.

import { MAX_IMAGE_BYTES } from "@/lib/answer-images";

/**
 * Longest edge of a normalized image. Chosen for PAYLOAD, not legibility: a
 * vision tower resizes to its own fixed budget regardless (Gemma's SigLIP takes
 * 896x896), so a larger cap buys the model nothing and costs every following
 * turn of the thread. 2000px keeps a real photo well under 1 MB at the quality
 * below — a ~10x reduction on a 24 MP original.
 */
export const MAX_NORMALIZED_EDGE = 2000;

/** JPEG quality for the re-encode. Artifacts here are far below what the model's own downsampling destroys. */
export const NORMALIZED_JPEG_QUALITY = 0.85;

/**
 * The ceiling on the file a student may PICK, as opposed to {@link MAX_IMAGE_BYTES},
 * which bounds what we SEND. The two are different numbers because normalization
 * sits between them: a 20 MP phone photo is a perfectly good input that happens to
 * arrive at 8 MB and leaves at 300 KB. CopilotKit checks its `maxSize` against the
 * original `File` BEFORE `onUpload` runs, so this is the value the chat hands it.
 */
export const MAX_RAW_IMAGE_BYTES = 30 * 1024 * 1024;

/**
 * The file-picker accept string. `image/*` alone is not enough: files handed over
 * by the iOS Files app and some third-party document providers carry an EMPTY
 * `File.type`, and CopilotKit's `matchesAcceptFilter` (a prefix test on that
 * field) drops them as "invalid-type" BEFORE any upload hook runs — where the
 * magic-byte sniffing below could never see them. The dot-filters match on the
 * FILENAME instead, so those files reach the normalizer, which decides by content.
 */
export const IMAGE_ACCEPT_WITH_EXTENSIONS =
  "image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.avif";

/** Container identified from the leading bytes — what the file ACTUALLY is, whatever it claims. */
export type ImageContainer =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "bmp"
  | "tiff"
  | "heif"
  | "avif"
  | "svg"
  | "unknown";

/** Why a file could not be turned into something a vision model can read. */
export type NormalizeFailureReason =
  | "raw-too-large"
  | "heif-undecodable"
  | "undecodable"
  | "encode-failed"
  | "too-large";

/**
 * Everything we learned about one picked file. Content-free by construction —
 * no pixels, and the filename is reduced to its extension (a real upload can be
 * `Mathe_Hausaufgabe_Lisa.jpg`), so a report may be pasted into a bug thread.
 */
export interface ImageDiagnostics {
  /** Lower-case extension incl. the dot (`.jpg`), or `""` when the name has none. */
  extension: string;
  /** Length of the original filename — enough to spot a truncation bug, carries no name. */
  nameLength: number;
  /** What the BROWSER said the type was. Empty string is itself a finding. */
  reportedType: string;
  /** What the leading bytes say it is. A mismatch against `reportedType` is a finding. */
  sniffedContainer: ImageContainer;
  /** Original size in bytes. */
  rawBytes: number;
  /** `File.lastModified`, or `undefined` when the platform withheld it. */
  lastModified?: number;
  /** JPEG EXIF `Orientation` (1..8) when present. >1 means an un-normalized send would have been rotated. */
  exifOrientation?: number;
  /** Whether a JPEG carried ANY EXIF block (so, potentially GPS). */
  hasExif: boolean;
  /** Decoded dimensions, absent when the decode failed. */
  decodedWidth?: number;
  decodedHeight?: number;
  /** Constructor name of the decode error (`EncodingError`, `InvalidStateError`, …). */
  decodeError?: string;
  /** True when the file was already fine and was sent through untouched. */
  passedThrough?: boolean;
  /** Result of the re-encode, absent when it never ran. */
  outputWidth?: number;
  outputHeight?: number;
  outputBytes?: number;
  outputMimeType?: string;
  /** Wall-clock milliseconds for decode + encode. */
  elapsedMs?: number;
  /** Set on failure — the same discriminant the caller branches on. */
  failureReason?: NormalizeFailureReason;
}

export type NormalizeImageResult =
  | {
      ok: true;
      /** `data:image/…;base64,…`, ready to inline into a model request. */
      dataUrl: string;
      mimeType: string;
      diagnostics: ImageDiagnostics;
    }
  | {
      ok: false;
      reason: NormalizeFailureReason;
      /** Student-facing, actionable, and specific to what the bytes turned out to be. */
      message: string;
      diagnostics: ImageDiagnostics;
    };

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] as number);
  }
  return out;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

/**
 * Identify the container from the leading bytes. PURE — no DOM, so it runs in a
 * plain unit test and on the diagnostics page alike. The point is to be able to
 * say "your phone saved this as HEIC" instead of "this file could not be read",
 * even on a platform whose decoder never got far enough to tell us.
 *
 * ISO-BMFF (HEIF/AVIF) is `....ftyp<brand>`; the brand at offset 8 separates
 * them, and `mif1`/`msf1` are the generic image brands Apple also emits.
 */
export function sniffImageContainer(bytes: Uint8Array): ImageContainer {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "tiff";
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
    if (HEIF_BRANDS.has(brand)) return "heif";
  }
  // SVG is text; skip any BOM/whitespace and look for the opening tag.
  const head = ascii(bytes, 0, 256).trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return "unknown";
}

/** Reading the EXIF `Orientation` out of a JPEG. `undefined` = not a JPEG, no EXIF, or no such tag. */
export interface ExifSummary {
  /** True when an APP1/Exif segment is present at all — so, possibly GPS. */
  hasExif: boolean;
  /** The `Orientation` tag value, 1..8. */
  orientation?: number;
}

/**
 * Minimal JPEG APP1/TIFF walk for the `Orientation` tag (0x0112).
 *
 * This is NOT needed to normalize — every browser bakes orientation into the
 * decode. It is load-bearing for the PASS-THROUGH decision: a small, otherwise
 * fine photo that skips the canvas would reach the model with its orientation
 * tag intact and be read sideways, which is the very bug we are fixing. It also
 * lets a diagnostics report say whether a file carried EXIF at all.
 *
 * Deliberately shallow: IFD0 only, no sub-IFDs, no GPS parsing (we only report
 * that EXIF exists, never what is in it).
 */
export function readExifSummary(bytes: Uint8Array): ExifSummary {
  if (!startsWith(bytes, [0xff, 0xd8])) return { hasExif: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  // Walk the marker segments looking for APP1 (0xFFE1) carrying "Exif\0\0".
  while (offset + 4 <= bytes.length) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    // Standalone markers (no length field) and start-of-scan: nothing after is EXIF.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) break;
    if (marker === 0xe1 && ascii(bytes, offset + 4, 4) === "Exif") {
      const tiff = offset + 10;
      if (tiff + 8 > bytes.length) return { hasExif: true };
      const endian = ascii(bytes, tiff, 2);
      const little = endian === "II";
      if (!little && endian !== "MM") return { hasExif: true };
      const ifdOffset = view.getUint32(tiff + 4, little);
      const ifd = tiff + ifdOffset;
      if (ifd + 2 > bytes.length) return { hasExif: true };
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) break;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return { hasExif: true, orientation: value >= 1 && value <= 8 ? value : undefined };
        }
      }
      return { hasExif: true };
    }
    offset += 2 + segmentLength;
  }
  return { hasExif: false };
}

/**
 * `true` when a PNG can carry transparency (IHDR colour type 4/6, or a `tRNS`
 * chunk on a palette image).
 *
 * Load-bearing for the PASS-THROUGH decision, not for the canvas path: a
 * transparent PNG that skipped the canvas keeps its alpha, and the server-side
 * decoder drops that channel WITHOUT compositing — transparent pixels keep their
 * stored RGB, which is usually black. That is the same black-on-black homework
 * the white fill exists to prevent, arriving by the other door.
 */
function pngMayHaveAlpha(bytes: Uint8Array): boolean {
  // 8-byte signature, then IHDR: length(4) + "IHDR"(4) + width(4) + height(4) +
  // bit depth(1) — so the colour type is byte 25.
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;
  // Palette images declare per-entry transparency in a separate chunk; it sits
  // before the image data, well inside the head we already read.
  return ascii(bytes, 0, 2048).includes("tRNS");
}

/** `.jpg` from `IMG_1234.JPG`; `""` when the name carries no extension. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

const CONTAINER_MIME: Partial<Record<ImageContainer, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  heif: "image/heic",
  svg: "image/svg+xml",
};

/**
 * Decode via `HTMLImageElement` rather than `createImageBitmap`. Both apply EXIF
 * orientation identically in every current engine, but `createImageBitmap` needs
 * iOS 15+ and school iPads run older — this path has no such floor, at no cost.
 */
function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new DOMException("The image could not be decoded", "EncodingError"));
    img.src = url;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("unreadable"));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.readAsDataURL(file);
  });
}

/** Re-labels a data URL with the container we sniffed, since `File.type` is not trustworthy. */
function relabelDataUrl(dataUrl: string, mimeType: string): string {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? dataUrl : `data:${mimeType};base64,${dataUrl.slice(comma + 1)}`;
}

const MESSAGES: Record<NormalizeFailureReason, string> = {
  "raw-too-large":
    "This photo is too large to send. Take it again at a lower resolution, or pick a smaller copy.",
  "heif-undecodable":
    "Your phone saved this photo as HEIC, which this browser cannot open. On an iPhone: Settings → Camera → Formats → Most Compatible, then take the photo again. Or open it in Photos and share it as a JPEG.",
  undecodable:
    "This file could not be opened as an image. It may be damaged, or saved in a format this browser does not support — try a JPEG or PNG.",
  "encode-failed": "This photo could not be prepared for sending. Please try a different photo.",
  "too-large": "This photo could not be reduced enough to send. Please try a different photo.",
};

export interface NormalizeImageOptions {
  maxEdge?: number;
  quality?: number;
  /** Overrides the raw ceiling; the diagnostics page passes the production value explicitly. */
  maxRawBytes?: number;
  /** Bounds the SENT payload — the normalized output, not the picked file. */
  maxOutputBytes?: number;
}

/**
 * Decode a picked file in the browser and hand back something a vision model can
 * certainly read: an upright image, bounded in size, in a format every server-side
 * decoder understands.
 *
 * PASS-THROUGH: a file that is already fine — JPEG or PNG, within the edge cap,
 * under the send cap, and carrying no orientation tag — is returned UNTOUCHED, so
 * a crisp screenshot of an exercise is not softened by a pointless JPEG round-trip.
 * The orientation condition is not optional: a rotated photo that skipped the
 * canvas would arrive sideways at the model.
 *
 * Never throws: every failure comes back as `{ ok: false, reason, message }` with
 * the diagnostics gathered so far, because the caller's job is to explain the
 * problem to a student, not to handle an exception.
 */
export async function normalizeStudentImage(
  file: File,
  options: NormalizeImageOptions = {},
): Promise<NormalizeImageResult> {
  const maxEdge = options.maxEdge ?? MAX_NORMALIZED_EDGE;
  const quality = options.quality ?? NORMALIZED_JPEG_QUALITY;
  const maxRawBytes = options.maxRawBytes ?? MAX_RAW_IMAGE_BYTES;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_IMAGE_BYTES;
  const started = performance.now();

  const diagnostics: ImageDiagnostics = {
    extension: extensionOf(file.name ?? ""),
    nameLength: (file.name ?? "").length,
    reportedType: file.type ?? "",
    sniffedContainer: "unknown",
    rawBytes: file.size,
    hasExif: false,
    ...(Number.isFinite(file.lastModified) ? { lastModified: file.lastModified } : {}),
  };

  const fail = (reason: NormalizeFailureReason): NormalizeImageResult => {
    diagnostics.failureReason = reason;
    diagnostics.elapsedMs = Math.round(performance.now() - started);
    return { ok: false, reason, message: MESSAGES[reason], diagnostics };
  };

  // Bound the read itself: decoding a hundreds-of-megabytes file to RGBA is how a
  // phone browser tab dies, and nothing downstream would accept it anyway.
  if (file.size > maxRawBytes) return fail("raw-too-large");

  // Sniff + EXIF from the head only; the full buffer is never held alongside the
  // decoded bitmap. 64 KB comfortably covers a JPEG's APP1 block.
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  diagnostics.sniffedContainer = sniffImageContainer(head);
  const exif = readExifSummary(head);
  diagnostics.hasExif = exif.hasExif;
  if (exif.orientation !== undefined) diagnostics.exifOrientation = exif.orientation;

  const url = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await decodeImage(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    diagnostics.decodeError = error instanceof DOMException ? error.name : "Error";
    // The sniff is what lets this be actionable: the decoder failed either way,
    // but only the bytes can say "this is HEIC" and name the setting to change.
    const container = diagnostics.sniffedContainer;
    return fail(container === "heif" || container === "avif" ? "heif-undecodable" : "undecodable");
  }

  try {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    diagnostics.decodedWidth = width;
    diagnostics.decodedHeight = height;
    if (width === 0 || height === 0) {
      diagnostics.decodeError = "ZeroSize";
      return fail("undecodable");
    }

    const container = diagnostics.sniffedContainer;
    const upright = (exif.orientation ?? 1) === 1;
    const alreadySmall = width <= maxEdge && height <= maxEdge && file.size <= maxOutputBytes;
    const opaque = container !== "png" || !pngMayHaveAlpha(head);
    if ((container === "jpeg" || container === "png") && upright && alreadySmall && opaque) {
      const mimeType = CONTAINER_MIME[container] as string;
      const dataUrl = relabelDataUrl(await readAsDataUrl(file), mimeType);
      diagnostics.passedThrough = true;
      diagnostics.outputWidth = width;
      diagnostics.outputHeight = height;
      diagnostics.outputBytes = file.size;
      diagnostics.outputMimeType = mimeType;
      diagnostics.elapsedMs = Math.round(performance.now() - started);
      return { ok: true, dataUrl, mimeType, diagnostics };
    }

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return fail("encode-failed");
    // A transparent PNG (a note-app screenshot, an exported whiteboard drawing)
    // composites onto a fresh canvas as BLACK, and JPEG has no alpha to save it —
    // dark-on-dark homework the model cannot read. Paint white first.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // Format choice: a PNG that only needed FLATTENING (a screenshot of an
    // exercise, say) stays a lossless PNG — putting text through a JPEG encoder
    // for no reason is exactly what the pass-through rule exists to avoid.
    // Anything that had to be resized is a photo by nature and becomes JPEG.
    const outputMime = container === "png" && scale === 1 ? "image/png" : "image/jpeg";
    let blob = await encodeCanvas(canvas, outputMime, quality);
    // A flattened PNG can come out LARGER than the file we started with; JPEG is
    // the fallback, and one cheaper retry beats refusing a photo that is nearly
    // small enough.
    if (blob && blob.size > maxOutputBytes && outputMime !== "image/jpeg") {
      blob = await encodeCanvas(canvas, "image/jpeg", quality);
    }
    if (blob && blob.size > maxOutputBytes) blob = await encodeCanvas(canvas, "image/jpeg", 0.6);
    if (!blob) return fail("encode-failed");
    if (blob.size > maxOutputBytes) return fail("too-large");

    const dataUrl = await readAsDataUrl(blob);
    diagnostics.passedThrough = false;
    diagnostics.outputWidth = targetWidth;
    diagnostics.outputHeight = targetHeight;
    diagnostics.outputBytes = blob.size;
    // Read the type off the BLOB, not the request: the fallbacks above may have
    // changed it, and the caller labels the payload with whatever we report.
    const producedMime = blob.type || "image/jpeg";
    diagnostics.outputMimeType = producedMime;
    diagnostics.elapsedMs = Math.round(performance.now() - started);
    return { ok: true, dataUrl, mimeType: producedMime, diagnostics };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  // `toBlob` hands back `null` when the encoder fails — a real branch, not a type
  // formality, so callers must not assume a Blob. `quality` is ignored for PNG.
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}
