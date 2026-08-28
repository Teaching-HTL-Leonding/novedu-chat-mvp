// Shared limits + the SERVER-AUTHORITATIVE validator for student-supplied
// images. Deliberately free of DOM code: `lib/quiz-actions.ts` is a
// `"use server"` module and imports `validateAnswerImages`, so anything that
// touches `window` would ride into the server-action module graph. The browser
// half — sniffing, decoding, resizing, re-encoding — lives in
// `lib/image-normalize.ts`.
//
// The 5 MB cap bounds what is SENT, not what may be picked: images are inlined
// as base64 into the request AND (for discussions) replayed from Mastra memory
// on every following turn, so a big file bloats both the request body and the
// model's context on every turn thereafter. Normalization sits in front of it,
// so a 24 MP phone photo is a perfectly good input that simply arrives larger
// than it leaves — the ceiling on the PICK is `MAX_RAW_IMAGE_BYTES` there.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_ANSWER = 3;

export type ValidateAnswerImagesResult =
  | { ok: true; images: string[] }
  | { ok: false; message: string };

/**
 * The formats the server accepts. Narrower than "any `image/*`" on purpose:
 * everything now arrives through `normalizeStudentImage`, which emits JPEG for
 * anything it re-encodes and passes through only already-fine JPEG/PNG. A
 * container outside this pair means the client skipped normalization, and the
 * one thing we know about such bytes is that the model may not be able to read
 * them.
 */
const IMAGE_DATA_URL = /^data:image\/(jpeg|png);base64,/;

/** Decoded byte size of a base64 payload (3 bytes per 4 chars, minus padding). */
function base64Bytes(payload: string): number {
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return (payload.length * 3) / 4 - padding;
}

/**
 * SERVER-SIDE validation of the images a quiz answer carries. Pure string
 * checks, so both quiz actions share it: images must be allowed by the
 * question's effective `imageInput` flag, at most 3, each a well-formed
 * `data:image/{jpeg,png};base64,` URL of at most 5 MB decoded.
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
