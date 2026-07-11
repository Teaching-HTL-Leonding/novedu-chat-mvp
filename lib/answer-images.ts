// Shared limits + helpers for student-supplied images. CLIENT-SAFE and pure at
// module level — the quiz runner and the tutor chat import the constants, the
// quiz runner uses `readAnswerImage` (browser-only at runtime: FileReader), and
// the quiz server actions re-check everything with `validateAnswerImages`
// (server-authoritative — the client is never trusted).
//
// The 5 MB cap matches the tutor module's attachment limit: images are inlined
// as base64 into the request AND (for discussions) replayed from Mastra memory
// on every following turn, so big files would bloat both the request body and
// the model's context.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_ANSWER = 3;
/** The file-picker accept string — any image; phones offer the camera directly. */
export const IMAGE_ACCEPT = "image/*";

export type ReadAnswerImageResult = { ok: true; dataUrl: string } | { ok: false; message: string };

/**
 * Validates a picked file (type + size) and reads it to a base64 data URL.
 * Browser-only (FileReader). Returns a friendly per-file message on rejection —
 * the caller shows it in a dismissible notice.
 */
export function readAnswerImage(file: File): Promise<ReadAnswerImageResult> {
  if (!file.type.startsWith("image/")) {
    return Promise.resolve({ ok: false, message: `${file.name}: only image files can be added.` });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.resolve({
      ok: false,
      message: `${file.name}: each photo must be 5 MB or smaller.`,
    });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
        resolve({ ok: true, dataUrl });
      } else {
        resolve({ ok: false, message: `${file.name}: this file could not be read.` });
      }
    };
    reader.onerror = () =>
      resolve({ ok: false, message: `${file.name}: this file could not be read.` });
    reader.readAsDataURL(file);
  });
}

export type ValidateAnswerImagesResult =
  | { ok: true; images: string[] }
  | { ok: false; message: string };

// A base64 image data URL: `data:image/<subtype>;base64,<payload>`.
const IMAGE_DATA_URL = /^data:image\/[\w.+-]+;base64,/;

/** Decoded byte size of a base64 payload (3 bytes per 4 chars, minus padding). */
function base64Bytes(payload: string): number {
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return (payload.length * 3) / 4 - padding;
}

/**
 * SERVER-SIDE validation of the images a quiz answer carries. Pure string
 * checks, so both quiz actions share it: images must be allowed by the
 * question's effective `imageInput` flag, at most 3, each a well-formed
 * `data:image/…;base64,` URL of at most 5 MB decoded.
 */
export function validateAnswerImages(
  images: string[] | undefined,
  allowed: boolean,
): ValidateAnswerImagesResult {
  if (images === undefined || images.length === 0) return { ok: true, images: [] };
  if (!Array.isArray(images) || images.some((image) => typeof image !== "string")) {
    return { ok: false, message: "The submitted photos could not be read." };
  }
  if (!allowed) {
    return { ok: false, message: "Images are not accepted for this question." };
  }
  if (images.length > MAX_IMAGES_PER_ANSWER) {
    return { ok: false, message: "At most 3 photos per answer." };
  }
  for (const image of images) {
    if (!IMAGE_DATA_URL.test(image)) {
      return { ok: false, message: "The submitted photos could not be read." };
    }
    const payload = image.slice(image.indexOf(",") + 1);
    if (base64Bytes(payload) > MAX_IMAGE_BYTES) {
      return { ok: false, message: "Each photo must be 5 MB or smaller." };
    }
  }
  return { ok: true, images };
}
