import { openaiError } from "@/lib/coding-proxy";

// The OpenAI-shaped failure responses shared by BOTH public coding routes
// (`POST /api/coding/v1/chat/completions` and `GET /api/coding/v1/models`). They live
// here, not in a route, because the opaque 401 must stay byte-identical across the two:
// a caller that can tell the routes' rejections apart gains an oracle.
//
// Deliberately NOT in `lib/coding-proxy.ts`: that module is inside the CLI-bundled
// prompt-dump closure, and a `Response`-building helper has no business there.

export function errorResponse(
  message: string,
  status: number,
  type = "invalid_request_error",
  code: string | null = null,
): Response {
  return Response.json(openaiError(message, type, code), { status });
}

// EVERY rejected key gets this one byte-identical body, whatever the flavor: no
// bearer at all, a malformed one, an unknown one, a key whose code was deleted, or a
// key for a non-coding code. A caller learns only "this does not open the endpoint" —
// never whether a key exists or which activity it belongs to.
export function invalidApiKey(): Response {
  return errorResponse(
    "Invalid API key. Pass your personal API key as a Bearer token in the Authorization header.",
    401,
    "invalid_request_error",
    "invalid_api_key",
  );
}

/** A retryable outage — never the permanent-sounding 401 a rejected key gets. */
export function serviceUnavailable(status = 503): Response {
  return errorResponse("Service temporarily unavailable.", status, "server_error", null);
}
