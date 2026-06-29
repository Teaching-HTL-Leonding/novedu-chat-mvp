// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// HTTP-level integration test for the OpenAI-compatible coding endpoint. It drives
// the real POST handler with `Request` objects (the HTTP contract at the route
// boundary) and asserts OpenAI-shaped `Response`s. The two I/O seams it does NOT
// own are mocked: `checkCode` (the DB-backed code gate) and `loadCoding` (the YAML
// read). The SCCH upstream is mocked via global `fetch`, so the test is hermetic
// and deterministic — it exercises bearer parsing, the gate, the body transform
// forwarded upstream, and the (streamed and non-streamed) response passthrough.
//
// The real end-to-end path against SCCH is covered separately by driving
// little-coder against a dev server.

const checkCode = vi.hoisted(() => vi.fn());
const loadCoding = vi.hoisted(() => vi.fn());

vi.mock("@/lib/code-store", () => ({ checkCode }));
vi.mock("@/lib/coding-fetch", () => ({ loadCoding }));

import { POST } from "@/app/api/coding/v1/chat/completions/route";

const CODE = "abc123code";
const codingEntry = {
  code: CODE,
  module: "coding",
  fileUrl: "https://app.example/api/files/c",
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/coding/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CODE}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function chatBody() {
  return {
    model: "whatever-the-client-says",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "read_file" } }],
    stream: false,
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SCCH_BASE_URL = "https://scch.example/v1";
  process.env.SCCH_API_KEY = "scch-secret";
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

describe("POST /api/coding/v1/chat/completions — auth gate", () => {
  it("401s when the Authorization header is missing", async () => {
    const res = await POST(post(chatBody(), { authorization: "" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("invalid_api_key");
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("401s on an unknown code", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "unknown-code" });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(401);
  });

  it("403s on an expired code", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "expired" });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("key_inactive");
  });

  it("401s when the code is for a different module", async () => {
    checkCode.mockResolvedValue({ ok: true, entry: { ...codingEntry, module: "tutor" } });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(401);
  });

  it("503s when the code lookup fails", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "lookup-failed" });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(503);
  });

  it("passes the bearer token to checkCode VERBATIM (no sk- stripping)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await POST(post(chatBody(), { authorization: `Bearer sk-${CODE}` }));
    expect(checkCode).toHaveBeenCalledWith(`sk-${CODE}`);
  });
});

describe("POST /api/coding/v1/chat/completions — body handling", () => {
  it("413s when Content-Length exceeds the cap, before any DB work", async () => {
    const res = await POST(post(chatBody(), { "content-length": String(3 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error.code).toBe("request_too_large");
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("502s when the coding YAML cannot be loaded", async () => {
    loadCoding.mockResolvedValue({ ok: false, message: "gone" });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.message).toBe("gone");
  });

  it("400s on a non-JSON body", async () => {
    const res = await POST(post("not json {", {}));
    expect(res.status).toBe(400);
  });

  it("400s on a valid-JSON body that is not an object (e.g. an array)", async () => {
    const res = await POST(post([]));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/coding/v1/chat/completions — forwarding", () => {
  it("forwards to SCCH with the teacher prompt added, the model pinned, and the abort signal passed", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "cmpl-1", choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await POST(post(chatBody()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ id: "cmpl-1", choices: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://scch.example/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer scch-secret");
    // The client's disconnect must be able to cancel the upstream generation.
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("gemma-pinned");
    // chatBody() sends no system message, so the teacher's prompt leads.
    expect(sent.messages[0]).toEqual({ role: "system", content: "TEACHER PROMPT" });
    expect(sent.messages[1]).toEqual({ role: "user", content: "hi" });
    // Client-side tools pass through verbatim.
    expect(sent.tools[0].function.name).toBe("read_file");
  });

  it("appends the teacher prompt to the END of the client's own system message", async () => {
    fetchSpy.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await POST(
      post({
        ...chatBody(),
        messages: [
          { role: "system", content: "CLIENT" },
          { role: "user", content: "hi" },
        ],
      }),
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(init.body as string);
    expect(sent.messages[0]).toEqual({ role: "system", content: "CLIENT\n\nTEACHER PROMPT" });
    expect(sent.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("pipes a streamed SSE response straight back", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValue(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    const res = await POST(post({ ...chatBody(), stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe(sse);
  });

  it("passes an upstream error status/body through", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "model overloaded" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toBe("model overloaded");
  });

  it("502s when the SCCH fetch throws", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(502);
  });

  it("500s (not 502) when SCCH env is unconfigured, without calling fetch", async () => {
    process.env.SCCH_BASE_URL = "";
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
