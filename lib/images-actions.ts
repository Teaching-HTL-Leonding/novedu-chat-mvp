"use server";

import { revalidatePath } from "next/cache";
import { createImageForUser, MAX_IMAGE_BYTES } from "@/lib/image-service";
import { softDeleteImages } from "@/lib/image-store";
import { requireTeacherUserId } from "@/lib/student-mode";

// Teacher-only server actions for the app-hosted IMAGE surface. Mirrors
// `lib/files-actions.ts`: each gates with the shared `requireTeacherUserId()`,
// the policy pipeline lives in `lib/image-service.ts` (shared with the bearer
// API route, docs/api.md), and the mutating actions revalidate the list.
//
// Upload is ONE action carrying the `File` in `FormData`: the bytes reach the
// server, the service streams them into a new storage object and only then
// writes the metadata row. There is no upload slot and no confirm step.
//
// CSRF and body bounding come from the FRAMEWORK, not from code here: Next.js
// compares `Origin` with `Host` on every server-action POST, and
// `serverActions.bodySizeLimit` (25 MB, set in next.config.ts for quiz photos)
// caps the request. The image ceiling itself is `MAX_IMAGE_BYTES` (5 MB),
// checked here before the service and again while the adapter streams.

// The shared teacher-gate refusal for these image actions — only the verb
// (upload/delete) differs between the call sites.
function gateMessage(verb: string): string {
  return `Only teachers can ${verb} images.`;
}

/**
 * Uploads a NEW image — the gate plus `createImageForUser`
 * (`lib/image-service.ts`). The form posts `file` (the bytes), `name`, `mime`
 * and an optional `credit`; every field is re-checked here, because a
 * hand-crafted POST reaches this action just as the form does. Revalidates the
 * list on success.
 */
export async function uploadImage(
  formData: FormData,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return { ok: false, error: gateMessage("upload") };

  const incomplete = { ok: false as const, error: "The upload form was incomplete. Try again." };

  const files = formData.getAll("file");
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File)) return incomplete;

  const names = formData.getAll("name");
  const name = names[0];
  if (names.length !== 1 || typeof name !== "string") return incomplete;

  const mimes = formData.getAll("mime");
  const mime = mimes[0];
  if (mimes.length !== 1 || typeof mime !== "string") return incomplete;

  const credits = formData.getAll("credit");
  const credit = credits[0];
  if (credits.length > 1 || (credit !== undefined && typeof credit !== "string")) return incomplete;

  // Cheap and exact: refuse an oversized file before it is streamed anywhere.
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "The image is too large — the maximum is 5 MB." };
  }

  const result = await createImageForUser(gate.userId, { name, mime, credit, content: file });
  if (!result.ok) return { ok: false, error: result.message };

  revalidatePath("/images");
  return { ok: true, name: result.name };
}

/**
 * Bulk soft-delete behind the images list's "Delete Selected" button — the only way
 * to delete an image. Teacher-only; soft-deletes every selected image (and its
 * backing object, best-effort) in one transaction (`softDeleteImages`). Revalidates
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
