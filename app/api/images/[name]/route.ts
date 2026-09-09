import { ApiAuthError, requireBearerTeacher } from "@/lib/api-auth";
import { readBoundedFormData } from "@/lib/bounded-form";
import { createImageForUser } from "@/lib/image-service";
import { recordError } from "@/lib/telemetry";

// CLI/API bearer route uploading an image (docs/api.md) — ONE multipart request
// carries the bytes to the app, which streams them into a new storage object
// and writes the metadata row. There is no upload slot and no confirm step.
// Image bytes DO pass through the app, so the body is bounded twice: the
// streamed counter here caps the whole multipart envelope at 6 MiB, and the
// service caps the image itself at MAX_IMAGE_BYTES (5 MB). `Content-Length` is
// only a fast reject for honest clients — the counter is what binds.
// Create-only: a taken name is a 409 — images are immutable, delete +
// re-upload (web app) is the way to replace one.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// The whole multipart envelope: the 5 MB image plus part headers and boundaries,
// with room to spare. Deliberately larger than MAX_IMAGE_BYTES so an image at
// exactly the ceiling is refused by the SERVICE with its clear message rather
// than by the transport.
const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Uploads a NEW image named `<name>` (the URL segment). `multipart/form-data`
 * with `file` (the bytes, exactly one file part), `mime` (image/png,
 * image/jpeg or image/svg+xml) and an optional `credit`. Runs the identical
 * policy pipeline as the web form via `createImageForUser`
 * (lib/image-service.ts). 201 `{ id, name, mimeType, byteSize, credit }` with
 * the measured size; 400 `{ message }` (bad body/name/MIME/size), 409 (name
 * taken), 413 (body over 6 MiB), 503 (storage unavailable).
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    // AUTH FIRST: an unauthenticated request never gets its body read.
    const user = await requireBearerTeacher(request);
    const { name } = await params;

    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null) {
      const declared = Number(declaredLength);
      if (Number.isFinite(declared) && declared > MAX_MULTIPART_BYTES) {
        return json({ message: "Request body is too large." }, 413);
      }
    }

    const body = await readBoundedFormData(request, MAX_MULTIPART_BYTES);
    if (!body.ok) return json({ message: body.message }, body.status);
    const form = body.form;

    const files = form.getAll("file");
    const file = files[0];
    if (files.length !== 1 || !(file instanceof File)) {
      return json({ message: "file must be sent exactly once as a file part." }, 400);
    }
    const mimes = form.getAll("mime");
    const mime = mimes[0];
    if (mimes.length !== 1 || typeof mime !== "string") {
      return json(
        { message: "mime must be sent exactly once (image/png, image/jpeg or image/svg+xml)." },
        400,
      );
    }
    const credits = form.getAll("credit");
    const credit = credits[0];
    if (credits.length > 1 || (credit !== undefined && typeof credit !== "string")) {
      return json({ message: "credit must be sent at most once, as a string." }, 400);
    }

    const result = await createImageForUser(user.userId, { name, mime, credit, content: file });
    if (!result.ok) {
      const status =
        result.reason === "conflict" ? 409 : result.reason === "unavailable" ? 503 : 400;
      return json({ message: result.message }, status);
    }

    return json(
      {
        id: result.id,
        name: result.name,
        mimeType: result.mimeType,
        byteSize: result.byteSize,
        credit: result.credit,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      // Generic body; the validation detail stays server-side (telemetry).
      // `{ message }` is the ONE failure key on the bearer channel (docs/api.md).
      return Response.json(
        { message: error.message },
        { status: error.status, headers: { ...NO_STORE, "WWW-Authenticate": "Bearer" } },
      );
    }
    recordError(error, { "novedu.area": "api-images" });
    return json({ message: "Internal server error" }, 500);
  }
}
