// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// HTTP-level integration test for the OpenAI-compatible coding endpoint. It drives
// the real POST handler with `Request` objects (the HTTP contract at the route
// boundary) and asserts OpenAI-shaped `Response`s. The I/O seams it does NOT own
// are mocked: `lookupCodingKey` (the per-user API-key resolution), `checkCode` (the
// DB-backed code gate), `loadCoding` (the YAML read), `recordLlmUsage` (the metering
// write) and the Foundry token/URL machinery. The upstream is mocked via global
// `fetch`, so the test is hermetic and deterministic — it exercises bearer parsing,
// the two-row gate, per-user metering, the body transform + provider dialect
// adaptation forwarded upstream, and the (streamed and non-streamed) passthrough.
//
// The real end-to-end path against SCCH is covered separately by driving
// little-coder against a dev server.

const lookupCodingKey = vi.hoisted(() => vi.fn());
const checkCode = vi.hoisted(() => vi.fn());
const loadCoding = vi.hoisted(() => vi.fn());
const recordLlmUsage = vi.hoisted(() => vi.fn());
const foundryBearerToken = vi.hoisted(() => vi.fn());

// `effectiveLlm` stays REAL (pure precedence logic — the point of the override
// tests below); only the DB-backed gate is mocked.
vi.mock("@/lib/code-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/code-store")>()),
  checkCode,
}));
vi.mock("@/lib/coding-key-store", () => ({ lookupCodingKey }));
vi.mock("@/lib/coding-fetch", () => ({ loadCoding }));
vi.mock("@/lib/usage-store", () => ({ recordLlmUsage }));
vi.mock("@/lib/llm/foundry-endpoint", () => ({
  foundryBearerToken,
  foundryChatCompletionsUrl: () => "https://res.openai.azure.com/openai/v1/chat/completions",
}));

import { POST } from "@/app/api/coding/v1/chat/completions/route";

const CODE = "abc123code";
const USER_ID = "user-oid-1";
// A well-formed personal key: `nvk-` + 40 chars of [a-z0-9].
const API_KEY = `nvk-${"k9".repeat(20)}`;
const codingEntry = {
  code: CODE,
  module: "coding",
  fileUrl: "https://app.example/api/files/c",
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/coding/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// A streamed (chunked) request body — no Content-Length, so the header check can't see
// its size. Node requires `duplex: "half"` for a stream body (absent from the DOM types).
function postStream(
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/coding/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, ...headers },
    body: stream,
    // @ts-expect-error duplex is required by Node/undici for a stream body, not typed in lib.dom.
    duplex: "half",
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
  lookupCodingKey.mockResolvedValue({ status: "found", code: CODE, userId: USER_ID });
  checkCode.mockResolvedValue({ ok: true, entry: codingEntry });
  loadCoding.mockResolvedValue({
    ok: true,
    coding: { instructions: "TEACHER PROMPT", model: "gemma-pinned" },
  });
  foundryBearerToken.mockResolvedValue("entra-token");
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/coding/v1/chat/completions — auth gate", () => {
  // The one opaque body every rejected key gets, whatever the flavor. Captured from
  // the no-header case and compared byte-for-byte by the cases below: any divergence
  // would be an oracle telling a caller which of the failures it hit.
  async function missingAuthBody(): Promise<string> {
    const res = await POST(post(chatBody(), { authorization: "" }));
    expect(res.status).toBe(401);
    return await res.text();
  }

  it("401s when the Authorization header is missing, before any lookup", async () => {
    const res = await POST(post(chatBody(), { authorization: "" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("invalid_api_key");
    expect(lookupCodingKey).not.toHaveBeenCalled();
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("401s opaquely when an ACTIVITY CODE is sent as the bearer — a code is not a key", async () => {
    // The hard cutover: the code string reaches the key store like any other bearer,
    // finds nothing, and the code gate is never consulted.
    lookupCodingKey.mockResolvedValue({ status: "miss" });
    const res = await POST(post(chatBody(), { authorization: `Bearer ${CODE}` }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(await missingAuthBody());
    expect(lookupCodingKey).toHaveBeenCalledWith(CODE);
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("401s identically on a malformed key and on an unknown key", async () => {
    const expected = await missingAuthBody();
    lookupCodingKey.mockResolvedValue({ status: "miss" });

    const malformed = await POST(post(chatBody(), { authorization: "Bearer nvk-nope" }));
    expect(malformed.status).toBe(401);
    expect(await malformed.text()).toBe(expected);

    const unknown = await POST(post(chatBody()));
    expect(unknown.status).toBe(401);
    expect(await unknown.text()).toBe(expected);
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("passes the bearer token to the key lookup VERBATIM (no prefix stripping)", async () => {
    lookupCodingKey.mockResolvedValue({ status: "miss" });
    await POST(post(chatBody(), { authorization: `Bearer sk-${API_KEY}` }));
    expect(lookupCodingKey).toHaveBeenCalledWith(`sk-${API_KEY}`);
  });

  it("401s identically when the key's code is gone", async () => {
    const expected = await missingAuthBody();
    checkCode.mockResolvedValue({ ok: false, reason: "unknown-code" });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(expected);
    expect(checkCode).toHaveBeenCalledWith(CODE);
  });

  it("401s identically when the key's code is for a different module", async () => {
    const expected = await missingAuthBody();
    checkCode.mockResolvedValue({ ok: true, entry: { ...codingEntry, module: "tutor" } });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(expected);
  });

  it("403s on an expired code — the window closes every key the code issued", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "expired" });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("key_inactive");
  });

  it("503s when the code lookup fails", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "lookup-failed" });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(503);
  });

  it("503s identically when the KEY lookup fails — an outage is retryable, not a bad key", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "lookup-failed" });
    const codeOutage = await POST(post(chatBody()));
    const expected = await codeOutage.text();

    lookupCodingKey.mockResolvedValue({ status: "error" });
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(503);
    // The same body the code-lookup outage returns: the same failure, one query
    // earlier, must not read as a permanent "invalid key".
    expect(await res.text()).toBe(expected);
    expect(checkCode).toHaveBeenCalledTimes(1);
  });

  it("never echoes the API key in an error body", async () => {
    lookupCodingKey.mockResolvedValue({ status: "miss" });
    const res = await POST(post(chatBody()));
    expect(await res.text()).not.toContain(API_KEY);
  });
});

describe("POST /api/coding/v1/chat/completions — usage metering", () => {
  it("meters a non-streamed response against the code AND the key's user", async () => {
    loadCoding.mockResolvedValue({
      ok: true,
      coding: { instructions: "TEACHER PROMPT", model: "gemma-pinned", provider: "SCCH" },
    });
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cmpl-1",
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 30 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await POST(post(chatBody()));
    await res.text();

    // The tap runs off the response path, so wait for it rather than assuming order.
    await vi.waitFor(() => expect(recordLlmUsage).toHaveBeenCalledTimes(1));
    expect(recordLlmUsage).toHaveBeenCalledWith({
      code: CODE,
      module: "coding",
      userId: USER_ID,
      provider: "SCCH",
      model: "gemma-pinned",
      inputNew: 70,
      inputCached: 30,
      output: 20,
      toolCalls: 0,
    });
  });

  it("meters a streamed response against the code AND the key's user", async () => {
    const sse = `data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":7}}\n\ndata: [DONE]\n\n`;
    fetchSpy.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const res = await POST(post({ ...chatBody(), stream: true }));
    expect(await res.text()).toBe(sse);

    await vi.waitFor(() => expect(recordLlmUsage).toHaveBeenCalledTimes(1));
    expect(recordLlmUsage).toHaveBeenCalledWith(
      expect.objectContaining({ code: CODE, module: "coding", userId: USER_ID, output: 7 }),
    );
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

  it("413s an oversized chunked body that omits Content-Length — the streaming read bounds it", async () => {
    // 3 MiB enqueued with no Content-Length: the header check is blind to it, so the
    // streaming read in the handler must cancel it and reject, never forwarding upstream.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const res = await POST(postStream(stream));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("request_too_large");
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("passes the classic sampling dialect to SCCH untouched", async () => {
    fetchSpy.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await POST(post({ ...chatBody(), max_tokens: 900, temperature: 0.2, top_p: 0.9 }));
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(init.body as string);
    expect(sent.max_tokens).toBe(900);
    expect(sent.temperature).toBe(0.2);
    expect(sent.top_p).toBe(0.9);
  });

  it("pins the CODE's override model instead of the YAML's when the entry carries one", async () => {
    checkCode.mockResolvedValue({
      ok: true,
      entry: { ...codingEntry, llm: { provider: "SCCH", model: "override-model" } },
    });
    fetchSpy.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await POST(post(chatBody()));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://scch.example/v1/chat/completions");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("override-model");
    // The teacher's prompt still comes from the YAML — the override swaps only the LLM.
    expect(sent.messages[0]).toEqual({ role: "system", content: "TEACHER PROMPT" });
  });

  it("routes to Azure Foundry when the CODE's override says so, even for an SCCH YAML", async () => {
    checkCode.mockResolvedValue({
      ok: true,
      entry: { ...codingEntry, llm: { provider: "Azure Foundry", model: "gpt-5.4-mini" } },
    });
    fetchSpy.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await POST(post(chatBody()));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://res.openai.azure.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer entra-token");
    expect(JSON.parse(init.body as string).model).toBe("gpt-5.4-mini");
  });
});

describe("POST /api/coding/v1/chat/completions — forwarding via Azure Foundry", () => {
  beforeEach(() => {
    loadCoding.mockResolvedValue({
      ok: true,
      coding: {
        instructions: "TEACHER PROMPT",
        model: "gpt-5-pinned",
        provider: "Azure Foundry",
      },
    });
  });

  it("forwards to the Foundry URL with the Entra bearer and the adapted dialect", async () => {
    fetchSpy.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const res = await POST(
      post({ ...chatBody(), max_tokens: 900, temperature: 0.2, stream: true }),
    );
    expect(res.status).toBe(200);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://res.openai.azure.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer entra-token");

    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("gpt-5-pinned");
    // The dialect adaptation: max_tokens renamed, sampling params stripped …
    expect(sent.max_completion_tokens).toBe(900);
    expect(sent).not.toHaveProperty("max_tokens");
    expect(sent).not.toHaveProperty("temperature");
    // … while the usage-tap contract survives untouched.
    expect(sent.stream).toBe(true);
    expect(sent.stream_options).toEqual({ include_usage: true });
  });

  it("500s when the Entra token acquisition fails, without calling fetch", async () => {
    foundryBearerToken.mockRejectedValue(new Error("no az login"));
    const res = await POST(post(chatBody()));
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("413s an oversized body even while the token acquisition fails (no unhandled rejection)", async () => {
    // The token is requested BEFORE the body read; if the body is then rejected, the
    // abandoned auth promise must not surface as an unhandled rejection — vitest
    // fails the run on unhandled rejections, so this test is the tripwire.
    foundryBearerToken.mockRejectedValue(new Error("no az login"));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const res = await POST(postStream(stream));
    expect(res.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
