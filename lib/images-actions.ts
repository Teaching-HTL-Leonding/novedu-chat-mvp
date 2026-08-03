"use server";

import { revalidatePath } from "next/cache";
import { confirmImageUploadForUser, prepareImageUpload } from "@/lib/image-service";
import { softDeleteImages } from "@/lib/image-store";
import { requireTeacherUserId } from "@/lib/student-mode";

// Teacher-only server actions for the app-hosted IMAGE surface. Mirrors
// `lib/files-actions.ts`: each gates with the shared `requireTeacherUserId()`,
// the policy pipeline lives in `lib/image-service.ts` (shared with the bearer
// API routes, docs/api.md), and the mutating actions revalidate the list.
//
// Upload is CONFIRM-ONLY: the browser PUTs the bytes straight to Blob Storage
// with a short-lived create-only SAS (no app route serves image bytes), then
// `confirmImageUpload` validates the landed blob and writes the metadata row.
// No DB row exists until that confirm — an abandoned upload leaves at most an
// orphan blob, never a half-written record.

// Maps the shared teacher-gate failure to a message for these image actions —
// only the verb (upload/delete) differs between the call sites.
function gateMessage(reason: "not-teacher" | "no-user-id", verb: string): string {
  return reason === "not-teacher"
    ? `Only teachers can ${verb} images.`
    : "Your session carries no user id — sign in again.";
}

/**
 * Mints a short-lived, create-only upload SAS for a NEW image — the gate plus
 * `prepareImageUpload` (`lib/image-service.ts`), which validates name/MIME/size
 * and writes NO DB row (that happens in `confirmImageUpload`, once the bytes
 * are in place).
 */
export async function requestImageUpload(
  name: string,
  mime: string,
  size: number,
): Promise<{ ok: true; uploadUrl: string; blobPath: string } | { ok: false; error: string }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return { ok: false, error: gateMessage(gate.reason, "upload") };

  const result = await prepareImageUpload({ name, mime, byteSize: size });
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, uploadUrl: result.uploadUrl, blobPath: result.blobPath };
}

/**
 * Confirms a freshly-uploaded blob — the gate plus `confirmImageUploadForUser`
 * (`lib/image-service.ts`), which re-derives size/MIME from the landed blob
 * (never trusted from the client) and writes the metadata row. Revalidates the
 * list on success.
 */
export async function confirmImageUpload(
  name: string,
  blobPath: string,
  mime: string,
  credit?: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return { ok: false, error: gateMessage(gate.reason, "upload") };

  const result = await confirmImageUploadForUser(gate.userId, { name, blobPath, mime, credit });
  if (!result.ok) return { ok: false, error: result.message };

  revalidatePath("/images");
  return { ok: true, name: result.name };
}

/**
 * Bulk soft-delete behind the images list's "Delete Selected" button — the only way
 * to delete an image. Teacher-only; soft-deletes every selected image (and its
 * backing blob, best-effort) in one transaction (`softDeleteImages`). Revalidates
 * the list on success. Mirrors `deleteSelectedFilesAction`.
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
