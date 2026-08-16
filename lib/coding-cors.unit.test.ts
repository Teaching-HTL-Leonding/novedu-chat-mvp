import { afterEach, describe, expect, it } from "vitest";
import {
  allowedCodingOrigins,
  codingCorsHeaders,
  codingPreflightHeaders,
  DEFAULT_CODING_CORS_ORIGINS,
} from "@/lib/coding-cors";

// The CORS policy for the public coding endpoint: which browser origins are allowed, and
// the headers an allowed one gets. Pure, so it tests without a server.

function preflight(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/coding/v1/chat/completions", {
    method: "OPTIONS",
    headers,
  });
}

afterEach(() => {
  delete process.env.CODING_CORS_ORIGINS;
});

describe("allowedCodingOrigins", () => {
  it("falls back to the loopback dev origins when the env var is unset or blank", () => {
    expect(allowedCodingOrigins(undefined)).toEqual(DEFAULT_CODING_CORS_ORIGINS);
    expect(allowedCodingOrigins("   ")).toEqual(DEFAULT_CODING_CORS_ORIGINS);
  });

  it("REPLACES the default with the env var (not additive)", () => {
    const allowed = allowedCodingOrigins("https://play.example");
    expect(allowed).toEqual(["https://play.example"]);
    expect(allowed).not.toContain("http://localhost:8080");
  });

  it("splits on commas and normalizes trailing slashes, paths and host case", () => {
    expect(allowedCodingOrigins("https://play.example/ , HTTPS://Other.Example/some/path")).toEqual(
      ["https://play.example", "https://other.example"],
    );
  });

  it("skips empty entries and values that are not URLs at all", () => {
    expect(allowedCodingOrigins("https://ok.example, , not a url,")).toEqual([
      "https://ok.example",
    ]);
  });

  // The footgun this guard exists for: `new URL("localhost:8080")` does NOT throw — Node
  // parses `localhost:` as a scheme and the origin becomes the string "null", which would
  // otherwise match the real `Origin: null` of a sandboxed iframe or a file:// page.
  it("rejects a scheme-less entry instead of turning it into a wildcard for Origin: null", () => {
    expect(new URL("localhost:8080").origin).toBe("null"); // documents WHY the guard exists
    expect(allowedCodingOrigins("localhost:8080")).toEqual([]);
  });

  it("rejects non-http(s) schemes", () => {
    expect(allowedCodingOrigins("file:///tmp, ftp://x.example, data:text/html,x")).toEqual([]);
  });
});

describe("codingCorsHeaders", () => {
  it("returns nothing when the request carried no Origin (the CLI clients)", () => {
    expect(codingCorsHeaders(null)).toEqual({});
  });

  it("returns nothing for an origin that is not allowlisted", () => {
    process.env.CODING_CORS_ORIGINS = "https://play.example";
    expect(codingCorsHeaders("https://evil.example")).toEqual({});
  });

  it("echoes an allowed origin with Vary", () => {
    process.env.CODING_CORS_ORIGINS = "https://play.example";
    expect(codingCorsHeaders("https://play.example")).toEqual({
      "Access-Control-Allow-Origin": "https://play.example",
      Vary: "Origin",
    });
  });

  it("allows the loopback dev origins out of the box", () => {
    expect(codingCorsHeaders("http://localhost:8080")["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:8080",
    );
    expect(codingCorsHeaders("http://127.0.0.1:8080")["Access-Control-Allow-Origin"]).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("never matches a sandboxed page's `Origin: null`", () => {
    expect(codingCorsHeaders("null")).toEqual({});
  });
});

describe("codingPreflightHeaders", () => {
  it("returns nothing for a disallowed or absent origin", () => {
    expect(codingPreflightHeaders(preflight({ origin: "https://evil.example" }))).toEqual({});
    expect(codingPreflightHeaders(preflight({}))).toEqual({});
  });

  it("ECHOES the requested headers, so the OpenAI SDK's x-stainless-* batch passes", () => {
    const headers = codingPreflightHeaders(
      preflight({
        origin: "http://localhost:8080",
        "access-control-request-headers": "authorization,content-type,x-stainless-lang",
      }),
    );
    expect(headers).toEqual({
      "Access-Control-Allow-Origin": "http://localhost:8080",
      Vary: "Origin, Access-Control-Request-Headers",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization,content-type,x-stainless-lang",
      "Access-Control-Max-Age": "86400",
    });
  });

  it("falls back to authorization + content-type when none are requested", () => {
    const headers = codingPreflightHeaders(preflight({ origin: "http://localhost:8080" }));
    expect(headers["Access-Control-Allow-Headers"]).toBe("authorization, content-type");
  });
});
