import { ApiAuthError, requireBearerTeacher } from "@/lib/api-auth";
import { confirmImageUploadForUser } from "@/lib/image-service";
import { recordError } from "@/lib/telemetry";

// CLI/API bearer route confirming an image upload (docs/api.md) — step 3 of
// the confirm-only, direct-to-blob flow started by POST /api/images/<name>:
// inspects what actually landed in Blob Storage (size/MIME re-derived, never
// trusted from the client) and only then writes the novedu_images row as the
// verified bearer user. An image literally named "confirm" is unambiguous —
// its request-upload URL is /api/images/confirm (one segment), this route
// always has a name segment BEFORE /confirm. Like the web action, the
// client-supplied blobPath is teacher-level trust (the SAS the request step
// minted is the only way bytes got there).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Confirms the upload for image `<name>`. JSON body
 * `{ blobPath, mime, credit? }` — `blobPath` and `mime` echo the request
 * step; `credit` is an optional attribution string (trimmed, clamped to 512
 * chars). Runs `confirmImageUploadForUser` (lib/image-service.ts). 201
 * `{ name, mimeType, byteSize, credit }` with the blob-derived size; 400
 * `{ message }` (bad name/MIME, missing or off-policy blob — a bad landed
 * blob is deleted best-effort), 409 (name taken in a race), 503 (storage
 * unavailable).
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const user = await requireBearerTeacher(request);
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
    const { blobPath, mime, credit } = body as Record<string, unknown>;
    if (typeof blobPath !== "string") {
      return json({ message: "blobPath must be the string the upload request returned." }, 400);
    }
    if (typeof mime !== "string") {
      return json(
        { message: "mime must be a string (image/png, image/jpeg or image/svg+xml)." },
        400,
      );
    }
    if (credit !== undefined && typeof credit !== "string") {
      return json({ message: "credit must be a string when given." }, 400);
    }

    const result = await confirmImageUploadForUser(user.userId, { name, blobPath, mime, credit });
    if (!result.ok) {
      const status =
        result.reason === "conflict" ? 409 : result.reason === "unavailable" ? 503 : 400;
      return json({ message: result.message }, status);
    }

    return json(
      {
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
