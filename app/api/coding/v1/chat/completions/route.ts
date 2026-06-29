import { checkCode } from "@/lib/code-store";
import { loadCoding } from "@/lib/coding-fetch";
import { buildUpstreamChatBody, openaiError, parseBearerKey } from "@/lib/coding-proxy";
import { scchAuthHeader, scchChatCompletionsUrl } from "@/lib/scch-endpoint";
import { recordError } from "@/lib/telemetry";

// PUBLIC, NON-ENTRA route (excluded from the proxy.ts gate, like /api/files): the
// OpenAI-compatible Chat Completions endpoint for the "coding" module. An external
// coding agent (e.g. little-coder) points at `<origin>/api/coding/v1` and uses the
// CODE as its Bearer API key.
//
// This is a thin, gatekept pass-through: it re-checks the code (existence + window)
// on EVERY request — the single security boundary, same as every module — loads the
// teacher's coding YAML, folds the teacher's system prompt into the request (appended
// to the end of the client's own system message so the teacher has the final word),
// PINS the model, then forwards to SCCH (`${SCCH_BASE_URL}/chat/completions`) and pipes
// the response stream straight back. No Mastra, no memory, no server-side tool loop:
// client-side tools and streaming are preserved because the body is forwarded verbatim
// and the response is never parsed.

export const dynamic = "force-dynamic";

// Reject oversized client bodies up front: the body is buffered to parse + re-serialize,
// so an unbounded one is a memory/OOM vector on this public endpoint. The cap is far
// above a real request for a 32k-context model, but bounds worst-case memory.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function errorResponse(
  message: string,
  status: number,
  type = "invalid_request_error",
  code: string | null = null,
): Response {
  return Response.json(openaiError(message, type, code), { status });
}

export async function POST(req: Request): Promise<Response> {
  // 1. The code is the Bearer key.
  const code = parseBearerKey(req.headers.get("authorization"));
  if (!code) {
    return errorResponse(
      "Missing API key. Pass the code as a Bearer token in the Authorization header.",
      401,
      "invalid_request_error",
      "invalid_api_key",
    );
  }

  // 1a. Reject an oversized body before any DB work (chunked bodies without a
  // Content-Length skip this; the parse below still bounds them by failing fast).
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse(
      "Request body is too large.",
      413,
      "invalid_request_error",
      "request_too_large",
    );
  }

  // 2. Re-check existence + availability window (the single boundary).
  const verification = await checkCode(code);
  if (!verification.ok) {
    switch (verification.reason) {
      case "unknown-code":
        return errorResponse("Invalid API key.", 401, "invalid_request_error", "invalid_api_key");
      case "not-started":
      case "expired":
        return errorResponse(
          "This key is not active. It is outside its availability window.",
          403,
          "invalid_request_error",
          "key_inactive",
        );
      default:
        return errorResponse("Service temporarily unavailable.", 503, "server_error", null);
    }
  }
  const { entry } = verification;
  // A non-coding code is not a valid key for this endpoint — don't disclose more.
  if (entry.module !== "coding") {
    return errorResponse("Invalid API key.", 401, "invalid_request_error", "invalid_api_key");
  }

  // 3. Load the teacher's coding YAML (system prompt + pinned model).
  const loaded = await loadCoding(entry.fileUrl);
  if (!loaded.ok) {
    return errorResponse(loaded.message, 502, "server_error", null);
  }

  // 4. Read the client body and build the upstream body.
  let clientBody: Record<string, unknown>;
  try {
    const json: unknown = await req.json();
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new Error("body is not a JSON object");
    }
    clientBody = json as Record<string, unknown>;
  } catch {
    return errorResponse("Request body must be a JSON object.", 400);
  }
  const upstreamBody = buildUpstreamChatBody(clientBody, {
    instructions: loaded.coding.instructions,
    model: loaded.coding.model,
  });

  // 5. Resolve SCCH config up front, OUTSIDE the fetch try — a missing env var is a
  // server misconfiguration (distinct 500), not a "bad gateway".
  let scchUrl: string;
  let scchAuth: string;
  try {
    scchUrl = scchChatCompletionsUrl();
    scchAuth = scchAuthHeader();
  } catch (error) {
    recordError(error, { route: "coding-proxy", stage: "config" });
    return errorResponse("Service temporarily unavailable.", 500, "server_error", null);
  }

  // 6. Forward to SCCH. Pass the request's abort signal so a client disconnect cancels
  // the upstream generation instead of leaving the shared GPU running for nobody.
  let upstream: Response;
  try {
    upstream = await fetch(scchUrl, {
      method: "POST",
      headers: {
        Authorization: scchAuth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upstreamBody),
      signal: req.signal,
    });
  } catch (error) {
    // A client disconnect aborts this fetch too; that is expected, not a server error.
    if (!req.signal.aborted) {
      recordError(error, { route: "coding-proxy", stage: "upstream-fetch" });
    }
    return errorResponse("The upstream model is unreachable.", 502, "server_error", null);
  }

  // 7. Pipe the response (streamed or not) straight back, untouched. Copy the
  // upstream content-type so `text/event-stream` and JSON both pass through.
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Accel-Buffering", "no");
  return new Response(upstream.body, { status: upstream.status, headers });
}
