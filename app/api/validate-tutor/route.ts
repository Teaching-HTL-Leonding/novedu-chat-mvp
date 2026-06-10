import { requireEffectiveTeacher } from "@/lib/student-mode";
import { defaultFetcher, loadAndBuildTutorPrompt } from "@/lib/tutors";

// Thin server consumer of the reusable tutor core. Takes a public URL to a tutor
// definition YAML, returns the assembled system prompt or a structured error list.
// Teacher-only: validation is an authoring tool, and this is the enforcement
// point (the page-level check is only UX).
//
// SSRF note: this fetches an arbitrary user-supplied URL server-side. For this
// prototype we only restrict the scheme to http(s); a production deployment
// should additionally allow-list hosts / block private IP ranges and disable
// redirects.
export async function POST(req: Request) {
  try {
    await requireEffectiveTeacher();
  } catch {
    return Response.json(
      {
        ok: false,
        errors: [{ code: "FORBIDDEN", message: "This operation requires a teacher account" }],
        warnings: [],
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        ok: false,
        errors: [{ code: "BAD_REQUEST", message: "Request body must be JSON" }],
        warnings: [],
      },
      { status: 400 },
    );
  }

  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return Response.json(
      {
        ok: false,
        errors: [{ code: "INVALID_URL", message: "Provide a public http(s) URL" }],
        warnings: [],
      },
      { status: 400 },
    );
  }

  const result = await loadAndBuildTutorPrompt(url, defaultFetcher);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
