// CORS policy for the public, OpenAI-compatible coding endpoint
// (app/api/coding/v1/chat/completions). PURE — no I/O beyond reading the env var — so it
// unit-tests hermetically, like `lib/coding-proxy.ts`.
//
// The endpoint is authenticated by the CODE as an explicit `Authorization` bearer header:
// there is no cookie and no Entra session on this path, so a cross-origin page carries no
// ambient authority and CORS grants no capability a caller doesn't already have with a
// known code. The allowlist is nonetheless narrow — never a wildcard — so a leaked code
// cannot be spent from any page on the web.
//
// A CLI client (little-coder / pi) sends no `Origin` at all and gets no CORS headers: its
// responses are byte-identical to what they were before CORS existed.

/**
 * Browser origins allowed when `CODING_CORS_ORIGINS` is unset — the local playground in
 * dev only. A DEPLOYED browser client's origin is configured per deployment, never
 * hardcoded here (same posture as CODE_ORIGIN).
 */
export const DEFAULT_CODING_CORS_ORIGINS = ["http://localhost:8080", "http://127.0.0.1:8080"];

/**
 * The effective allowlist: `CODING_CORS_ORIGINS` (comma-separated) when set — it REPLACES
 * the default, it is not additive — otherwise {@link DEFAULT_CODING_CORS_ORIGINS}. Each
 * entry is normalized through `new URL().origin`, which lowercases the host and drops any
 * path/trailing slash.
 *
 * Entries that don't parse, or whose scheme is not http/https, are skipped. That scheme
 * check is load-bearing, not defensive noise: `new URL("localhost:8080")` does NOT throw —
 * Node reads `localhost:` as the scheme and yields the origin string `"null"`, which would
 * then match the real `Origin: null` browsers send from sandboxed iframes and `file://`
 * pages. A scheme-less typo must not silently open the endpoint to every sandboxed page on
 * the web.
 *
 * Read per request (the route is `force-dynamic`), like `resolveAppOrigin`.
 */
export function allowedCodingOrigins(raw = process.env.CODING_CORS_ORIGINS): string[] {
  const entries = raw?.trim() ? raw.split(",") : DEFAULT_CODING_CORS_ORIGINS;
  const allowed: string[] = [];
  for (const entry of entries) {
    const value = entry.trim();
    if (value === "") continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    allowed.push(url.origin);
  }
  return allowed;
}

/**
 * The CORS headers for an actual (non-preflight) response: empty when the request carried
 * no `Origin` (every CLI client) or one that is not allowed, so nothing changes for them.
 *
 * `Vary: Origin` is emitted only on the allowed branch. Strict HTTP-cache correctness
 * would send it on every Origin-dependent response, but keeping the CLI's responses
 * byte-identical is worth more here: success responses already carry `Cache-Control:
 * no-store`, and POST/OPTIONS are not shared-cached.
 */
export function codingCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  if (!allowedCodingOrigins().includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

/**
 * The preflight (`OPTIONS`) headers. Empty when the origin is not allowed — the browser
 * then blocks the real request.
 *
 * `Access-Control-Allow-Headers` ECHOES the requested headers rather than listing a fixed
 * set: the OpenAI JS SDK sends a batch of `x-stainless-*` headers a fixed list would
 * reject. Echoing is safe — headers are worthless without the code as the bearer key.
 */
export function codingPreflightHeaders(req: Request): Record<string, string> {
  const cors = codingCorsHeaders(req.headers.get("origin"));
  if (Object.keys(cors).length === 0) return {};
  const requested = req.headers.get("access-control-request-headers");
  return {
    ...cors,
    Vary: "Origin, Access-Control-Request-Headers",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": requested ?? "authorization, content-type",
    "Access-Control-Max-Age": "86400",
  };
}
