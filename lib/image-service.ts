import { randomUUID } from "node:crypto";
import {
  extensionForImageMime,
  type ImageMime,
  isImageMime,
  validateFileName,
} from "@/lib/file-name";
import { deleteBlob, getBlobProperties, mintWriteSas } from "@/lib/image-blob";
import { confirmImage, getActiveImage } from "@/lib/image-store";

// The transport-agnostic policy pipeline for the app-hosted IMAGE upload flow,
// shared by the web server actions (lib/images-actions.ts, cookie session) and
// the bearer API routes (app/api/images/**, docs/api.md). Auth NEVER enters
// this module — each channel gates itself and passes the verified user id in.
// Mirrors `lib/file-service.ts`; the `reason` discriminant lets the channels
// map failures differently (form message vs. HTTP 400/409/503).
//
// Upload stays CONFIRM-ONLY: `prepareImageUpload` mints a short-lived
// create-only SAS and writes NO DB row; the caller PUTs the bytes straight to
// Blob Storage; `confirmImageUploadForUser` inspects what actually landed and
// only then writes the metadata row. Never `revalidatePath` here — cache
// invalidation belongs to the web action channel.
//
// SERVER-ONLY: uses the database and Blob Storage. Never import from client
// components.

// The largest image the upload SAS / confirm will accept, in bytes (5 MB).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageServiceFailure =
  // The request itself is unacceptable (bad name/MIME/size, bad landed blob).
  | { ok: false; reason: "invalid"; message: string }
  // The name is already taken by an active image.
  | { ok: false; reason: "conflict"; message: string }
  // Storage/lookup infrastructure failed — retrying later may work.
  | { ok: false; reason: "unavailable"; message: string };

export type PrepareImageUploadResult =
  | { ok: true; uploadUrl: string; blobPath: string }
  | ImageServiceFailure;

/**
 * Mints a short-lived, create-only upload SAS for a NEW image, after validating
 * the name, MIME and claimed size — but writes NO DB row (that happens in
 * `confirmImageUploadForUser`, once the bytes are in place). Rejects a name
 * already in use by an active image up front, so the caller learns of the clash
 * before uploading. The blob path is a random UUID plus the MIME's extension,
 * so it never collides and never leaks the chosen name. Takes no user id — the
 * request step records nothing.
 */
export async function prepareImageUpload(input: {
  name: string;
  mime: string;
  byteSize: number;
}): Promise<PrepareImageUploadResult> {
  const nameValidation = validateFileName(input.name);
  if (!nameValidation.ok) return { ok: false, reason: "invalid", message: nameValidation.message };
  const cleanName = nameValidation.name;

  if (!isImageMime(input.mime)) {
    return { ok: false, reason: "invalid", message: "Only PNG, JPEG and SVG images are allowed." };
  }
  const size = input.byteSize;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return {
      ok: false,
      reason: "invalid",
      message: "The image is empty — choose a file with content.",
    };
  }
  if (size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: "invalid",
      message: "The image is too large — the maximum is 5 MB.",
    };
  }

  const active = await getActiveImage(cleanName);
  if (active === undefined) {
    return {
      ok: false,
      reason: "unavailable",
      message: "The name could not be checked right now — try again.",
    };
  }
  if (active !== null) {
    return {
      ok: false,
      reason: "conflict",
      message: "An image with that name already exists. Choose another name.",
    };
  }

  const blobPath = `${randomUUID()}.${extensionForImageMime(input.mime)}`;
  try {
    const uploadUrl = await mintWriteSas(blobPath, input.mime);
    return { ok: true, uploadUrl, blobPath };
  } catch (error) {
    console.error("image-service: minting upload SAS failed", error);
    return {
      ok: false,
      reason: "unavailable",
      message: "The upload could not be prepared. Try again.",
    };
  }
}

export type ConfirmImageUploadResult =
  | { ok: true; name: string; mimeType: ImageMime; byteSize: number; credit: string | null }
  | ImageServiceFailure;

/**
 * Confirms a freshly-uploaded blob by inspecting what actually landed and, if it
 * checks out, writing the metadata row as `userId`. The size/MIME are re-derived
 * from the blob (never trusted from the client): a blob that is missing, too
 * large, or of the wrong content type is rejected — and a present-but-bad blob
 * is deleted best-effort so it does not linger. On a name clash the row is not
 * written; the caller is told the name is taken.
 */
export async function confirmImageUploadForUser(
  userId: string,
  input: { name: string; blobPath: string; mime: string; credit?: string },
): Promise<ConfirmImageUploadResult> {
  const nameValidation = validateFileName(input.name);
  if (!nameValidation.ok) return { ok: false, reason: "invalid", message: nameValidation.message };
  const cleanName = nameValidation.name;

  if (!isImageMime(input.mime)) {
    return { ok: false, reason: "invalid", message: "Only PNG, JPEG and SVG images are allowed." };
  }
  const mime = input.mime;

  let props: { exists: boolean; contentType?: string; contentLength?: number };
  try {
    props = await getBlobProperties(input.blobPath);
  } catch (error) {
    console.error("image-service: reading blob properties failed", input.blobPath, error);
    return {
      ok: false,
      reason: "unavailable",
      message: "The upload could not be verified. Try again.",
    };
  }
  if (!props.exists) {
    return { ok: false, reason: "invalid", message: "The upload did not complete. Try again." };
  }

  const byteSize = props.contentLength ?? 0;
  if (byteSize <= 0 || byteSize > MAX_IMAGE_BYTES || props.contentType !== mime) {
    // A blob that landed but fails policy must not linger — remove it best-effort.
    try {
      await deleteBlob(input.blobPath);
    } catch (error) {
      console.error("image-service: removing rejected blob failed", input.blobPath, error);
    }
    return {
      ok: false,
      reason: "invalid",
      message: "The uploaded file is not a valid image of the expected type.",
    };
  }

  // Optional attribution ("Content Credentials"): trim, drop if empty, and clamp
  // to the column width so an overlong notice can never fail the insert.
  const cleanCredit =
    typeof input.credit === "string" && input.credit.trim() !== ""
      ? input.credit.trim().slice(0, 512)
      : null;

  const stored = await confirmImage(
    { name: cleanName, blobPath: input.blobPath, mimeType: mime, byteSize, credit: cleanCredit },
    userId,
  );
  if (!stored.ok) {
    return stored.reason === "name-taken"
      ? {
          ok: false,
          reason: "conflict",
          message: "An image with that name already exists. Choose another name.",
        }
      : {
          ok: false,
          reason: "unavailable",
          message: "The image could not be stored. Try again, or contact the operator.",
        };
  }

  return { ok: true, name: stored.name, mimeType: mime, byteSize, credit: cleanCredit };
}
