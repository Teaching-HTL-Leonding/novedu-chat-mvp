import type { ApiAuthError } from "@/lib/api-auth";

// The CHANNEL plumbing every CLI/API bearer route shares (docs/api.md), independent of
// any one feature: each handler is `force-dynamic`, answers `Cache-Control: no-store`,
// and every failure body is `{ message }` — including the generic 401/403, which also
// carries `WWW-Authenticate: Bearer`. Feature-specific helpers (report filters, wire
// shapes, …) stay in that feature's own `shared.ts`.

export const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function authErrorResponse(error: ApiAuthError): Response {
  // Generic body; the validation detail stays server-side (telemetry).
  // `{ message }` is the ONE failure key on the bearer channel (docs/api.md).
  return Response.json(
    { message: error.message },
    { status: error.status, headers: { ...NO_STORE, "WWW-Authenticate": "Bearer" } },
  );
}
