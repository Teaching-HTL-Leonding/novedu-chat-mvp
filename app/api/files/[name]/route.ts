import { getActiveFile, validateFileName } from "@/lib/file-store";

// PUBLIC, unauthenticated endpoint — deliberately excluded from the access gate
// in proxy.ts — that serves the LATEST version of an app-hosted YAML file as raw
// text. The URL `https://<origin>/api/files/<name>` therefore drops straight into
// the existing tutor-code flow: the chat loader fetches it server-side with no
// session, and teachers may share it publicly. Soft-deleted or unknown files 404.
//
// force-dynamic + `Cache-Control: no-store` so edits are visible immediately —
// the tutor-code flow re-fetches the tutor URL on every chat open and message and
// must never see a stale version (matching the "no caching by design" of the
// tutor-code loader).
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  // Reject malformed names without a database round-trip.
  if (!validateFileName(name).ok) {
    return new Response("Not found", { status: 404 });
  }

  const file = await getActiveFile(name);
  if (file === undefined) {
    // Database unreachable — transient, not a missing file.
    return new Response("File lookup failed", { status: 503 });
  }
  if (file === null) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file.content, {
    status: 200,
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
