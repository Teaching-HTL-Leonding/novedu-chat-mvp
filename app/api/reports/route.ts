import { ApiAuthError, requireBearerTeacher } from "@/lib/api-auth";
import { listReports } from "@/lib/report-store";
import { recordError } from "@/lib/telemetry";
import { authErrorResponse, json, parseReaction, parseStatus, toWire } from "./shared";

// CLI/API bearer route for LISTING reports (docs/api.md, docs/reports.md): the
// /reports inbox's exact filters + defaults over `listReports`. Excluded from
// the proxy.ts session gate (a CLI has no cookie); the ONLY access control is
// requireBearerTeacher — reviewing reports is role-gated, not owner-gated, and
// there is no "view as student" on the bearer channel. A report is
// non-anonymous toward teachers (the sanctioned waiver, docs/reports.md), so the
// reporter's oid + display name ride the wire shape.
export const dynamic = "force-dynamic";

/**
 * Lists reports with the /reports inbox's params + defaults: `status` (`open`
 * default | `resolved` | `all`), `reaction` (`good|omg|bad|holysh`, optional),
 * `q` free-text contains-search, `mine` default ON (`mine=0` widens to all
 * teachers' codes). An unknown `status`/`reaction` value is rejected loudly with
 * 400 (unlike the forgiving web UI). Bare JSON array in the inbox's order (open
 * `holysh` first, then newest first); store unavailable → 503.
 */
export async function GET(request: Request) {
  try {
    const user = await requireBearerTeacher(request);

    const params = new URL(request.url).searchParams;
    const status = parseStatus(params.get("status"));
    if (!status.ok) return json({ message: status.message }, 400);
    const reaction = parseReaction(params.get("reaction"));
    if (!reaction.ok) return json({ message: reaction.message }, 400);

    const q = (params.get("q") ?? "").trim();
    const onlyMine = params.get("mine") !== "0"; // default ON; "0" widens to all

    // No `paging`: this route deliberately returns the full match set (the CLI
    // consumes it whole), so the store runs no COUNT and emits no OFFSET/FETCH.
    const result = await listReports({
      status: status.value,
      reaction: reaction.value,
      search: q || undefined,
      codeCreatedBy: onlyMine ? user.userId : undefined,
    });
    if (result === undefined) {
      return json(
        { message: "Reports could not be loaded right now. Try again in a moment." },
        503,
      );
    }

    return json(result.rows.map(toWire), 200);
  } catch (error) {
    if (error instanceof ApiAuthError) return authErrorResponse(error);
    recordError(error, { "novedu.area": "api-reports" });
    return json({ message: "Internal server error" }, 500);
  }
}
