import { ApiAuthError, requireBearerTeacher } from "@/lib/api-auth";
import { setReportsResolved } from "@/lib/report-store";
import { recordError } from "@/lib/telemetry";
import { authErrorResponse, json, UUID_PATTERN } from "../shared";

// CLI/API bearer route for RESOLVING reports in bulk (docs/api.md,
// docs/reports.md). Self-gates with requireBearerTeacher (excluded from the
// proxy.ts session gate). Resolution is attributed like the web: `resolved_by`
// is always the authenticated teacher's oid — an agent resolves under the
// teacher who ran `novedu-cli login`. Reopen + delete stay web-only by design;
// this channel only ever resolves.
export const dynamic = "force-dynamic";

// Mirrors the web bulk actions' guard (lib/report-actions.ts `isReportIdList`):
// a non-empty array, every entry a canonical UUID. Anything else → 400.
function isReportIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
  );
}

/**
 * Marks the given reports resolved. JSON body `{ ids: [uuid…] }` — non-empty,
 * every entry UUID-shaped; anything else → 400. Stamps `resolved_at = now` +
 * `resolved_by` = the token oid via `setReportsResolved`. Already-resolved or
 * unknown ids are silent no-ops (the web action's blanket update). 200
 * `{ ok: true }`; store failure → 503.
 */
export async function POST(request: Request) {
  try {
    const user = await requireBearerTeacher(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ message: "The request body must be JSON." }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return json({ message: "The request body must be a JSON object." }, 400);
    }
    const { ids } = body as Record<string, unknown>;
    if (!isReportIdList(ids)) {
      return json({ message: "Provide a non-empty `ids` array of report UUIDs." }, 400);
    }

    if (!(await setReportsResolved(ids, true, user.userId))) {
      return json({ message: "Some reports could not be updated. Try again." }, 503);
    }
    return json({ ok: true }, 200);
  } catch (error) {
    if (error instanceof ApiAuthError) return authErrorResponse(error);
    recordError(error, { "novedu.area": "api-reports" });
    return json({ message: "Internal server error" }, 500);
  }
}
