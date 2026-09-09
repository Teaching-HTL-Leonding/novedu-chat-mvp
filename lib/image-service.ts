import { randomUUID } from "node:crypto";
import {
  extensionForImageMime,
  type ImageMime,
  isImageMime,
  validateFileName,
} from "@/lib/file-name";
import { deleteObject, writeNewObject } from "@/lib/image-fs";
import { createImage, getActiveImage } from "@/lib/image-store";
import { recordError } from "@/lib/telemetry";

// The transport-agnostic policy pipeline for the app-hosted IMAGE upload,
// shared by the web server action (lib/images-actions.ts, cookie session) and
// the bearer API route (app/api/images/<name>, docs/api.md). Auth NEVER enters
// this module — each channel gates itself and passes the verified user id in.
// Mirrors `lib/file-service.ts`; the `reason` discriminant lets the channels
// map failures differently (form message vs. HTTP 400/409/503).
//
// ONE call does the whole upload: the bytes stream through the app into a new
// filesystem object (`lib/image-fs.ts`), and only once they are published does
// the metadata row go in. There is no upload slot and no confirm step. Never
// `revalidatePath` here — cache invalidation belongs to the web action channel.
//
// The MIME is the DECLARED one, checked against the PNG/JPEG/SVG allowlist and
// stored beside the MEASURED byte length; no signature sniffing is promised.
//
// SERVER-ONLY: uses the database and the filesystem. Never import from client
// components.

// The largest image the upload accepts, in bytes (5 MB). Enforced TWICE — here
// before a single byte is written, and again by the adapter while streaming.
// `app/images/new/upload-image-form.tsx` carries a client copy of this literal
// (it is a client component and must not import this server module); a
// source-text guard in `lib/image-service.unit.test.ts` pins the two equal.
// `lib/answer-images.ts` has its own same-named constant for STUDENT photos —
// a different subsystem, deliberately not merged with this one.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const STORAGE_UNAVAILABLE = "Image storage is unavailable right now. Try again later.";

export type ImageServiceFailure =
  // The request itself is unacceptable (bad name/MIME/size, truncated upload).
  | { ok: false; reason: "invalid"; message: string }
  // The name is already taken by an active image.
  | { ok: false; reason: "conflict"; message: string }
  // Storage/lookup infrastructure failed — retrying later may work.
  | { ok: false; reason: "unavailable"; message: string };

export type CreateImageForUserResult =
  | {
      ok: true;
      /** The per-version row id — the byte URL is `/api/image-content/<id>`. */
      id: string;
      name: string;
      mimeType: ImageMime;
      byteSize: number;
      credit: string | null;
    }
  | ImageServiceFailure;

function invalid(message: string): ImageServiceFailure {
  return { ok: false, reason: "invalid", message };
}

// Removing the object we just wrote after the row failed. Best-effort by
// definition: a failed cleanup is logged and NEVER changes the result the
// caller already has.
async function discardObject(key: string): Promise<void> {
  const removed = await deleteObject(key);
  if (!removed.ok) {
    console.error("image-service: removing the orphaned object failed", key, removed.detail);
  }
}

/**
 * Stores ONE new image for `userId`: validate, reserve the name, stream the
 * bytes into a fresh object, then write the metadata row.
 *
 * The order is what makes the pair consistent (docs/images.md): the object
 * exists before the row, so a crash in between leaves an unreferenced object
 * (harmless, reconcilable) and never a row pointing at nothing. If the insert
 * DEFINITELY failed, the object is removed; if its outcome is UNCERTAIN (the
 * connection broke, the insert may have committed), the object is deliberately
 * left in place and the incident recorded.
 */
export async function createImageForUser(
  userId: string,
  input: { name: string; mime: string; credit?: string; content: Blob },
): Promise<CreateImageForUserResult> {
  const nameValidation = validateFileName(input.name);
  if (!nameValidation.ok) return invalid(nameValidation.message);
  const cleanName = nameValidation.name;

  if (!isImageMime(input.mime)) {
    return invalid("Only PNG, JPEG and SVG images are allowed.");
  }
  const mime: ImageMime = input.mime;

  const size = input.content.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return invalid("The image is empty — choose a file with content.");
  }
  if (size > MAX_IMAGE_BYTES) {
    return invalid("The image is too large — the maximum is 5 MB.");
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

  // The key never leaks the chosen name: a random UUID plus the MIME's
  // extension. `Blob.stream()` yields a fresh stream per call, so the one
  // collision retry can replay the same bytes.
  let key = `${randomUUID()}.${extensionForImageMime(mime)}`;
  let written = await writeNewObject(key, input.content.stream(), MAX_IMAGE_BYTES);
  if (!written.ok && written.reason === "exists") {
    key = `${randomUUID()}.${extensionForImageMime(mime)}`;
    written = await writeNewObject(key, input.content.stream(), MAX_IMAGE_BYTES);
  }
  if (!written.ok) {
    switch (written.reason) {
      case "too-large":
        return invalid("The image is too large — the maximum is 5 MB.");
      case "empty":
        return invalid("The image is empty — choose a file with content.");
      case "source":
        return invalid("The upload did not complete. Try again.");
      default:
        console.error("image-service: writing the image object failed", written.detail);
        return { ok: false, reason: "unavailable", message: STORAGE_UNAVAILABLE };
    }
  }

  // Optional attribution ("Content Credentials"): trim, drop if empty, and clamp
  // to the column width so an overlong notice can never fail the insert.
  const credit =
    typeof input.credit === "string" && input.credit.trim() !== ""
      ? input.credit.trim().slice(0, 512)
      : null;

  const stored = await createImage(
    { name: cleanName, blobPath: key, mimeType: mime, byteSize: written.byteLength, credit },
    userId,
  );
  if (!stored.ok) {
    if (stored.reason === "name-taken") {
      await discardObject(key);
      return {
        ok: false,
        reason: "conflict",
        message: "An image with that name already exists. Choose another name.",
      };
    }
    if (stored.outcome === "definite") {
      await discardObject(key);
    } else {
      // The row MAY have committed. Deleting the object now could orphan a live
      // row, which is far worse than an unreferenced object.
      console.error(
        "image-service: uncertain insert outcome — object left for reconciliation",
        key,
      );
      recordError(new Error("image-service: uncertain image insert outcome"), {
        "novedu.area": "image-service",
        "novedu.image.key": key,
      });
    }
    return {
      ok: false,
      reason: "unavailable",
      message: "The image could not be stored. Try again, or contact the operator.",
    };
  }

  return {
    ok: true,
    id: stored.id,
    name: stored.name,
    mimeType: mime,
    byteSize: written.byteLength,
    credit,
  };
}
