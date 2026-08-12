import { ApiAuthError, requireBearerTeacher } from "@/lib/api-auth";
import { mintReadSas } from "@/lib/image-blob";
import { listImages } from "@/lib/image-store";
import { recordError } from "@/lib/telemetry";

// CLI/API bearer route listing app-hosted images (docs/api.md) with the
// /images list's filters, keeping this channel's own `mine` param (the page
// spells that narrowing `?owner=`). Unlike /api/files there is NO
// public GET under this prefix — the /api/images exclusion in proxy.ts exists
// only so bearer requests (which carry no Entra session cookie) reach these
// self-gating handlers. Active versions only; the bytes stay in Blob Storage
// (no app route ever serves them) — `url` is a short-lived read SAS.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Lists active images: `q` contains-matches the name, `mine` defaults ON
 * (`mine=0` widens to all teachers' images). Bare JSON array, newest first;
 * `url` is a short-lived (~3 h) read SAS straight to the blob — or null when
 * minting fails for that row — and `createdAt` the active version's write time
 * (ISO 8601 UTC).
 */
export async function GET(request: Request) {
  try {
    const user = await requireBearerTeacher(request);

    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    const onlyMine = params.get("mine") !== "0"; // default ON; "0" turns it off

    // No `paging`: this route deliberately returns the full match set (the CLI
    // consumes it whole), so the store runs no COUNT and emits no OFFSET/FETCH.
    const result = await listImages({
      search: q || undefined,
      createdBy: onlyMine ? user.userId : undefined,
    });
    if (result === undefined) {
      return json({ message: "Images could not be loaded right now. Try again in a moment." }, 503);
    }

    // One bad blob must not fail the whole list — mirror app/images/page.tsx.
    const rows = await Promise.all(
      result.rows.map(async (entry) => ({
        name: entry.name,
        mimeType: entry.mimeType,
        byteSize: entry.byteSize,
        credit: entry.credit,
        createdBy: entry.createdBy,
        createdAt: entry.validFrom.toISOString(),
        url: await mintReadSas(entry.blobPath).catch(() => null),
      })),
    );
    return json(rows, 200);
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
