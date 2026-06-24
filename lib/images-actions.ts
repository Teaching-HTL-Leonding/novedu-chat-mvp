"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { extensionForImageMime, isImageMime, validateFileName } from "@/lib/file-name";
import { deleteBlob, getBlobProperties, mintWriteSas } from "@/lib/image-blob";
import { confirmImage, getActiveImage, softDeleteImage, softDeleteImages } from "@/lib/image-store";
import { requireTeacherUserId } from "@/lib/student-mode";

// Teacher-only server actions for the app-hosted IMAGE surface. Mirrors
// `lib/files-actions.ts`: each gates with the shared `requireTeacherUserId()`,
// and the delete actions revalidate the list. Storage metadata lives in
// `lib/image-store.ts`; the bytes live in Azure Blob Storage, reached only
// through `lib/image-blob.ts`. This is the thin auth + policy shell around both.
//
// Upload is CONFIRM-ONLY: the browser PUTs the bytes straight to Blob Storage
// with a short-lived create-only SAS (no app route serves image bytes), then
// `confirmImageUpload` validates the landed blob and writes the metadata row.
// No DB row exists until that confirm — an abandoned upload leaves at most an
// orphan blob, never a half-written record.

// The largest image the upload SAS / confirm will accept, in bytes (5 MB).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Maps the shared teacher-gate failure to a message for these image actions —
// only the verb (upload/delete) differs between the call sites.
function gateMessage(reason: "not-teacher" | "no-user-id", verb: string): string {
  return reason === "not-teacher"
    ? `Only teachers can ${verb} images.`
    : "Your session carries no user id — sign in again.";
}

/**
 * Mints a short-lived, create-only upload SAS for a NEW image, after gating and
 * validating the name, MIME and size — but writes NO DB row (that happens in
 * `confirmImageUpload`, once the bytes are in place). Rejects a name already in
 * use by an active image up front, so the teacher learns of the clash before
 * uploading. The blob path is a random UUID plus the MIME's extension, so it
 * never collides and never leaks the chosen name.
 */
export async function requestImageUpload(
  name: string,
  mime: string,
  size: number,
): Promise<{ ok: true; uploadUrl: string; blobPath: string } | { ok: false; error: string }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return { ok: false, error: gateMessage(gate.reason, "upload") };

  const nameValidation = validateFileName(name);
  if (!nameValidation.ok) return { ok: false, error: nameValidation.message };
  const cleanName = nameValidation.name;

  if (!isImageMime(mime)) {
    return { ok: false, error: "Only PNG, JPEG and SVG images are allowed." };
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "The image is empty — choose a file with content." };
  }
  if (size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "The image is too large — the maximum is 5 MB." };
  }

  const active = await getActiveImage(cleanName);
  if (active === undefined) {
    return { ok: false, error: "The name could not be checked right now — try again." };
  }
  if (active !== null) {
    return { ok: false, error: "An image with that name already exists. Choose another name." };
  }

  const blobPath = `${randomUUID()}.${extensionForImageMime(mime)}`;
  try {
    const uploadUrl = await mintWriteSas(blobPath, mime);
    return { ok: true, uploadUrl, blobPath };
  } catch (error) {
    console.error("images-actions: minting upload SAS failed", error);
    return { ok: false, error: "The upload could not be prepared. Try again." };
  }
}

/**
 * Confirms a freshly-uploaded blob by inspecting what actually landed and, if it
 * checks out, writing the metadata row. The size/MIME are re-derived from the
 * blob (never trusted from the client): a blob that is missing, too large, or of
 * the wrong content type is rejected — and a present-but-bad blob is deleted so
 * it does not linger. On a name clash the row is not written; the caller is told
 * the name is taken.
 */
export async function confirmImageUpload(
  name: string,
  blobPath: string,
  mime: string,
  credit?: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return { ok: false, error: gateMessage(gate.reason, "upload") };
  const userId = gate.userId;

  const nameValidation = validateFileName(name);
  if (!nameValidation.ok) return { ok: false, error: nameValidation.message };
  const cleanName = nameValidation.name;

  if (!isImageMime(mime)) {
    return { ok: false, error: "Only PNG, JPEG and SVG images are allowed." };
  }

  let props: { exists: boolean; contentType?: string; contentLength?: number };
  try {
    props = await getBlobProperties(blobPath);
  } catch (error) {
    console.error("images-actions: reading blob properties failed", blobPath, error);
    return { ok: false, error: "The upload could not be verified. Try again." };
  }
  if (!props.exists) {
    return { ok: false, error: "The upload did not complete. Try again." };
  }

  const byteSize = props.contentLength ?? 0;
  if (byteSize <= 0 || byteSize > MAX_IMAGE_BYTES || props.contentType !== mime) {
    // A blob that landed but fails policy must not linger — remove it best-effort.
    try {
      await deleteBlob(blobPath);
    } catch (error) {
      console.error("images-actions: removing rejected blob failed", blobPath, error);
    }
    return { ok: false, error: "The uploaded file is not a valid image of the expected type." };
  }

  // Optional attribution ("Content Credentials"): trim, drop if empty, and clamp
  // to the column width so an overlong notice can never fail the insert.
  const cleanCredit =
    typeof credit === "string" && credit.trim() !== "" ? credit.trim().slice(0, 512) : null;

  const stored = await confirmImage(
    { name: cleanName, blobPath, mimeType: mime, byteSize, credit: cleanCredit },
    userId,
  );
  if (!stored.ok) {
    return {
      ok: false,
      error:
        stored.reason === "name-taken"
          ? "An image with that name already exists. Choose another name."
          : "The image could not be stored. Try again, or contact the operator.",
    };
  }

  revalidatePath("/images");
  return { ok: true, name: stored.name };
}

/**
 * Soft-deletes an image (and its backing blob, best-effort, inside the store).
 * Idempotent: an already-gone image still reports success so the row clears from
 * the list. Revalidates the list on completion. Mirrors `deleteFileAction`.
 */
export async function deleteImageAction(name: string): Promise<{ ok: boolean }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return { ok: false };

  const result = await softDeleteImage(name, gate.userId);
  if (!result.ok && result.reason === "error") {
    return { ok: false };
  }

  revalidatePath("/images");
  return { ok: true };
}

/**
 * Bulk soft-delete behind the images list's "Delete Selected" button. Teacher-only
 * (same gate as the single delete) and runs the SAME store primitive in one
 * transaction (`softDeleteImages`), so a multi-delete is identical, row for row,
 * to pressing each row's trash button. Revalidates the list on success. Mirrors
 * `deleteSelectedFilesAction`.
 */
export async function deleteSelectedImagesAction(
  names: string[],
): Promise<{ ok: boolean; deleted: number }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return { ok: false, deleted: 0 };

  const result = await softDeleteImages(names, gate.userId);
  if (!result.ok) {
    return { ok: false, deleted: 0 };
  }

  revalidatePath("/images");
  return { ok: true, deleted: result.deleted };
}
