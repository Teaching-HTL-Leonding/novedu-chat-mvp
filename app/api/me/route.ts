import { ApiAuthError, requireBearerUser } from "@/lib/api-auth";
import { recordError } from "@/lib/telemetry";

// Identity probe for the CLI/API bearer channel (docs/api.md): `novedu-cli
// whoami` calls it to verify the full token round-trip. Excluded from the
// proxy.ts session gate (a CLI has no cookie); the ONLY access control is the
// bearer token validated by requireBearerUser. Any authenticated user may call
// it — it reports the teacher flag rather than requiring it, which makes it a
// useful diagnostic for misconfigured accounts.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireBearerUser(request);
    return Response.json({ name: user.name, userId: user.userId, isTeacher: user.isTeacher });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      // Generic body; the validation detail stays server-side (telemetry).
      // `{ message }` is the ONE failure key on the bearer channel (docs/api.md).
      return Response.json(
        { message: error.message },
        { status: error.status, headers: { "WWW-Authenticate": "Bearer" } },
      );
    }
    recordError(error, { "novedu.area": "api-me" });
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
