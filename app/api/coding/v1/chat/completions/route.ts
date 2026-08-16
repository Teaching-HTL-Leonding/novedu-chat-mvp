import { readBoundedJson } from "@/lib/bounded-json";
import { checkCode, effectiveLlm } from "@/lib/code-store";
import { loadCoding } from "@/lib/coding-fetch";
import {
  buildUpstreamChatBody,
  extractCodingUsage,
  openaiError,
  parseBearerKey,
} from "@/lib/coding-proxy";
import { type ChatEndpoint, resolveChatEndpoint } from "@/lib/llm/endpoint";
import { recordError } from "@/lib/telemetry";
import { recordLlmUsage } from "@/lib/usage-store";

// PUBLIC, NON-ENTRA route (excluded from the proxy.ts gate, like /api/files): the
// OpenAI-compatible Chat Completions endpoint for the "coding" module. An external
// coding agent (e.g. little-coder) points at `<origin>/api/coding/v1` and uses the
// CODE as its Bearer API key.
//
// This is a thin, gatekept pass-through: it re-checks the code (existence + window)
// on EVERY request — the single security boundary, same as every module — loads the
// teacher's coding YAML, folds the teacher's system prompt into the request (appended
// to the end of the client's last system message so the teacher has the final word),
// PINS the model, then forwards to the activity's provider endpoint (SCCH or Azure
// Foundry, resolved by the side-effect-free `resolveChatEndpoint` — this route never
// learns which) and pipes the response stream straight back. No Mastra, no memory, no
// server-side tool loop: client-side tools and streaming are preserved because the
// body is forwarded verbatim and the response is never parsed.

export const dynamic = "force-dynamic";

// Reject oversized client bodies: the body is buffered to parse + re-serialize, so an
// unbounded one is a memory/OOM vector on this public endpoint. The cap is far above a
// real request for a 32k-context model, but bounds worst-case memory.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// The usage-tap accumulates decoded response text only to find the trailing `usage`.
// For SSE that chunk is at the very end, so a bounded tail suffices; keeping the last
// slice caps memory on a pathological upstream while still catching the usage line.
const MAX_TAP_CHARS = 64 * 1024;

// Reads the upstream response copy to completion (off the client path), extracts the
// final token usage, and meters it against the CODE only (this path has no oid, so it
// never touches usage_by_user), attributed to the activity's provider + pinned model.
// Best-effort: never throws into the request.
async function tapCodingUsage(
  stream: ReadableStream<Uint8Array>,
  isStream: boolean,
  code: string,
  llm: { provider: string; model: string },
): Promise<void> {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
      // SSE usage sits at the end → keep only a tail. A non-streamed body is a single
      // small JSON object, so it is not trimmed (trimming would break the parse).
      if (isStream && text.length > MAX_TAP_CHARS) text = text.slice(-MAX_TAP_CHARS);
    }
    text += decoder.decode();
    const usage = extractCodingUsage(text, isStream);
    if (!usage) return;
    await recordLlmUsage({
      code,
      module: "coding",
      provider: llm.provider,
      model: llm.model,
      inputNew: Math.max(0, usage.inputTokens - usage.cachedInputTokens),
      inputCached: usage.cachedInputTokens,
      output: usage.outputTokens,
      toolCalls: 0,
    });
  } catch (error) {
    recordError(error, { route: "coding-proxy", stage: "usage-tap" });
  }
}

function errorResponse(
  message: string,
  status: number,
  type = "invalid_request_error",
  code: string | null = null,
): Response {
  return Response.json(openaiError(message, type, code), { status });
}

// The bounded body read lives in `lib/bounded-json.ts` — shared verbatim with the
// teacher-only `/api/eval/grade`, the other route that buffers a client-supplied body.

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

  // 1a. Fast-reject a body whose declared Content-Length already exceeds the cap,
  // before any DB work. This is only a shortcut for honest clients — a chunked body can
  // omit Content-Length, so the real bound is the streaming read in step 4.
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

  // 3. Load the teacher's coding YAML (system prompt + pinned model). The code's
  // LLM override pair, when set, replaces the YAML's provider/model — the pinned
  // model and the upstream endpoint below both follow the EFFECTIVE pair.
  const loaded = await loadCoding(entry.fileUrl);
  if (!loaded.ok) {
    return errorResponse(loaded.message, 502, "server_error", null);
  }
  const llm = effectiveLlm(entry, loaded.coding);

  // 4. Resolve the provider endpoint up front, OUTSIDE the fetch try — a missing env
  // var or a failed Entra token acquisition (Foundry) is a server misconfiguration
  // (distinct 500), not a "bad gateway". The token acquisition STARTS here so the
  // Entra round trip overlaps the client-body read; the guard branch keeps an early
  // 400/413 return from surfacing it as an unhandled rejection — the real handling
  // is the await in step 6.
  let endpoint: ChatEndpoint;
  let authPromise: Promise<string>;
  try {
    endpoint = resolveChatEndpoint(llm.provider);
    authPromise = endpoint.authHeader();
    authPromise.catch(() => {});
  } catch (error) {
    recordError(error, { route: "coding-proxy", stage: "config" });
    return errorResponse("Service temporarily unavailable.", 500, "server_error", null);
  }

  // 5. Read the client body under a hard byte cap, then build the upstream body and
  // let the provider adapt its parameter dialect (e.g. Foundry's max_completion_tokens).
  const parsed = await readBoundedJson(req, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return errorResponse(parsed.message, parsed.status, "invalid_request_error", parsed.code);
  }
  const upstreamBody = endpoint.adaptBody(
    buildUpstreamChatBody(parsed.value, {
      instructions: loaded.coding.instructions,
      model: llm.model,
    }),
  );

  // 6. Await the (already in-flight) auth header.
  let upstreamAuth: string;
  try {
    upstreamAuth = await authPromise;
  } catch (error) {
    recordError(error, { route: "coding-proxy", stage: "config" });
    return errorResponse("Service temporarily unavailable.", 500, "server_error", null);
  }

  // 7. Forward upstream. Pass the request's abort signal so a client disconnect cancels
  // the upstream generation instead of leaving the shared GPU running for nobody.
  let upstream: Response;
  try {
    upstream = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: upstreamAuth,
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

  // 8. Pipe the response (streamed or not) straight back, untouched. Copy the
  // upstream content-type so `text/event-stream` and JSON both pass through.
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Accel-Buffering", "no");

  // 9. Meter token usage WITHOUT altering the passthrough: tee the body, forward one
  // branch to the client byte-for-byte, and read the other in the background to
  // extract the final `usage`. Coding usage is per-CODE only (no oid on this path).
  if (upstream.body) {
    const [toClient, toTap] = upstream.body.tee();
    const isStream = (contentType ?? "").includes("text/event-stream");
    void tapCodingUsage(toTap, isStream, entry.code, llm);
    return new Response(toClient, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
