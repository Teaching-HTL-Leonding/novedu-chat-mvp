import { ApiAuthError, requireBearerTeacher } from "@/lib/api-auth";
import { prepareImageUpload } from "@/lib/image-service";
import { recordError } from "@/lib/telemetry";

// CLI/API bearer route starting an image upload (docs/api.md) — step 1 of the
// same confirm-only, direct-to-blob flow the web form uses: this handler mints
// a short-lived create-only SAS and writes NO DB row; the client PUTs the
// bytes straight to Blob Storage; POST /api/images/<name>/confirm inspects the
// landed blob and writes the row. Image bytes NEVER pass through the app.
// Create-only: a taken name is a 409 — images are immutable, delete +
// re-upload (web app) is the way to replace one.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Requests an upload slot for a NEW image named `<name>`. JSON body
 * `{ mime, byteSize }` (the claimed size; the confirm step re-derives the real
 * one from the landed blob). Runs the identical policy pipeline as the web
 * form via `prepareImageUpload` (lib/image-service.ts). 200
 * `{ uploadUrl, blobPath }` — PUT the raw bytes to `uploadUrl` with
 * `x-ms-blob-type: BlockBlob` and a Content-Type equal to `mime`, then POST
 * the confirm route. 400 `{ message }` (bad name/MIME/size), 409 (name taken),
 * 503 (storage unavailable).
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    await requireBearerTeacher(request);
    const { name } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ message: "The request body must be JSON." }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return json({ message: "The request body must be a JSON object." }, 400);
    }
    const { mime, byteSize } = body as Record<string, unknown>;
    if (typeof mime !== "string") {
      return json(
        { message: "mime must be a string (image/png, image/jpeg or image/svg+xml)." },
        400,
      );
    }
    if (typeof byteSize !== "number") {
      return json({ message: "byteSize must be a number (the image size in bytes)." }, 400);
    }

    const result = await prepareImageUpload({ name, mime, byteSize });
    if (!result.ok) {
      const status =
        result.reason === "conflict" ? 409 : result.reason === "unavailable" ? 503 : 400;
      return json({ message: result.message }, status);
    }

    return json({ uploadUrl: result.uploadUrl, blobPath: result.blobPath }, 200);
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
