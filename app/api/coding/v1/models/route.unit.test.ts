// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// HTTP-level integration test for the OpenAI-conventional models list. It drives the
// real GET handler with `Request` objects and mocks only the two I/O seams the gate
// rests on: `lookupCodingKey` (the per-user API-key resolution) and `checkCode` (the
// DB-backed code gate). The route is the cheap key-validity check, so the tests below
// pin BOTH halves of that: the auth mapping is identical to the completions route
// (asserted against that route's own responses, byte-for-byte on the opaque 401), and
// a success touches no upstream and meters nothing.

const lookupCodingKey = vi.hoisted(() => vi.fn());
const checkCode = vi.hoisted(() => vi.fn());
const loadCoding = vi.hoisted(() => vi.fn());
const recordLlmUsage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/code-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/code-store")>()),
  checkCode,
}));
vi.mock("@/lib/coding-key-store", () => ({ lookupCodingKey }));
// Only the sibling route (imported below to compare rejections) reaches these; the
// models route must never call either, which the tests assert.
vi.mock("@/lib/coding-fetch", () => ({ loadCoding }));
vi.mock("@/lib/usage-store", () => ({ recordLlmUsage }));

import { POST } from "@/app/api/coding/v1/chat/completions/route";
import { GET } from "@/app/api/coding/v1/models/route";
import { CODING_MODEL_ID } from "@/lib/coding-connection";

const CODE = "abc123code";
const USER_ID = "user-oid-1";
const API_KEY = `nvk-${"k9".repeat(20)}`;
const codingEntry = {
  code: CODE,
  module: "coding",
  fileUrl: "https://app.example/api/files/c",
};

function get(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/coding/v1/models", {
    method: "GET",
    headers: { authorization: `Bearer ${API_KEY}`, ...headers },
  });
}

/** The sibling route's response for the same auth state — the mapping to match. */
function siblingPost(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/coding/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
      ...headers,
    },
    body: JSON.stringify({ model: "x", messages: [{ role: "user", content: "hi" }] }),
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  lookupCodingKey.mockResolvedValue({ status: "found", code: CODE, userId: USER_ID });
  checkCode.mockResolvedValue({ ok: true, entry: codingEntry });
  loadCoding.mockResolvedValue({
    ok: true,
    coding: { instructions: "TEACHER PROMPT", model: "gemma-pinned" },
  });
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/coding/v1/models — auth gate", () => {
  it("401s when the Authorization header is missing, before any lookup", async () => {
    const res = await GET(get({ authorization: "" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_api_key");
    expect(lookupCodingKey).not.toHaveBeenCalled();
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("returns the completions route's own 401 body, byte-for-byte", async () => {
    // The two public coding routes must reject identically: a caller able to tell them
    // apart would hold an oracle the opaque 401 exists to deny.
    const sibling = await POST(siblingPost({ authorization: "" }));
    const res = await GET(get({ authorization: "" }));
    expect(res.status).toBe(sibling.status);
    expect(await res.text()).toBe(await sibling.text());
  });

  it("401s on a malformed key without reaching the code gate", async () => {
    lookupCodingKey.mockResolvedValue({ status: "miss" });
    const res = await GET(get({ authorization: "Bearer nvk-nope" }));
    expect(res.status).toBe(401);
    expect(lookupCodingKey).toHaveBeenCalledWith("nvk-nope");
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("401s identically on an unknown key", async () => {
    const expected = await (await GET(get({ authorization: "" }))).text();
    lookupCodingKey.mockResolvedValue({ status: "miss" });
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(expected);
  });

  it("503s when the key lookup fails — an outage is retryable, not a bad key", async () => {
    lookupCodingKey.mockResolvedValue({ status: "error" });
    const res = await GET(get());
    expect(res.status).toBe(503);
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("503s when the code lookup fails", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "lookup-failed" });
    const res = await GET(get());
    expect(res.status).toBe(503);
  });

  it("401s identically when the key's code is gone", async () => {
    const expected = await (await GET(get({ authorization: "" }))).text();
    checkCode.mockResolvedValue({ ok: false, reason: "unknown-code" });
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(expected);
  });

  it("401s identically when the key's code is for a different module", async () => {
    const expected = await (await GET(get({ authorization: "" }))).text();
    checkCode.mockResolvedValue({ ok: true, entry: { ...codingEntry, module: "tutor" } });
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(expected);
  });

  it.each(["not-started", "expired"])("403s with key_inactive on a %s code", async (reason) => {
    checkCode.mockResolvedValue({ ok: false, reason });
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("key_inactive");
  });

  it("answers the window rejection exactly as the completions route does", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "expired" });
    const sibling = await POST(siblingPost());
    const res = await GET(get());
    expect(res.status).toBe(sibling.status);
    expect(await res.text()).toBe(await sibling.text());
  });

  it("never echoes the API key in an error body", async () => {
    lookupCodingKey.mockResolvedValue({ status: "miss" });
    expect(await (await GET(get())).text()).not.toContain(API_KEY);
  });
});

describe("GET /api/coding/v1/models — the list", () => {
  it("returns the single generic model id for a valid key on an open code", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      object: "list",
      data: [{ id: CODING_MODEL_ID, object: "model", created: 0, owned_by: "novedu" }],
    });
  });

  it("reaches no upstream, no YAML and no metering — nothing was generated", async () => {
    // The whole point of the cheap validity check: the teacher's real model, provider
    // and system prompt are never loaded, so they cannot leak through this route.
    await GET(get());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loadCoding).not.toHaveBeenCalled();
    expect(recordLlmUsage).not.toHaveBeenCalled();
  });

  it("re-verifies the key's own code on every request", async () => {
    await GET(get());
    await GET(get());
    expect(lookupCodingKey).toHaveBeenCalledTimes(2);
    expect(checkCode).toHaveBeenNthCalledWith(1, CODE);
    expect(checkCode).toHaveBeenNthCalledWith(2, CODE);
  });
});
