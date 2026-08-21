// @vitest-environment node

import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The WIRE contract of the SCCH provider, asserted against the REAL
// `@ai-sdk/openai-compatible` (unlike app/mastra/scch.unit.test.ts, which mocks
// the package to inspect the construction options). Everything that must hold is
// only observable in the request body the package finally POSTs, so the HTTP call
// is the seam that is stubbed — nothing else:
//
//  - `reasoning_effort` carries the level `modelEntry` filed under the "scch"
//    providerOptions key (a wrong key would silently drop it);
//  - `stream_options.include_usage` rides every STREAMING call (metering);
//  - assistant history never carries `reasoning_content` outbound
//    (`transformRequestBody` — see app/mastra/scch.ts),
//
// …on BOTH `doGenerate` and `doStream`, which build their bodies separately.

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

const captured = vi.hoisted(() => [] as CapturedCall[]);

// Env + the fetch stub must exist BEFORE app/mastra/scch.ts is imported: it reads
// the env at module scope and runs its model discovery in a top-level await.
vi.hoisted(() => {
  process.env.SCCH_BASE_URL = "https://scch.test/v1";
  process.env.SCCH_API_KEY = "sk-wire-test";

  const chatCompletion = JSON.stringify({
    id: "cmpl-1",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const sse = [
    `data: ${JSON.stringify({
      id: "cmpl-1",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
    })}`,
    `data: ${JSON.stringify({
      id: "cmpl-1",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    // The startup model discovery (a GET) — answer it so the import stays offline.
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "m" }] }), {
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    captured.push({ url, body });
    return body.stream === true
      ? new Response(sse, { headers: { "content-type": "text/event-stream" } })
      : new Response(chatCompletion, { headers: { "content-type": "application/json" } });
  });
});

import { scchProvider } from "@/app/mastra/scch";
import { SCCH_PROVIDER_NAME } from "@/lib/llm/provider";

// A previous assistant turn whose thinking the package would otherwise replay as
// `reasoning_content` on the outgoing message.
const PROMPT: LanguageModelV3Prompt = [
  { role: "user", content: [{ type: "text", text: "A train travels 120 km in 90 min." }] },
  {
    role: "assistant",
    content: [
      { type: "reasoning", text: "120 / 1.5 = 80 — the student must not see this." },
      { type: "text", text: "80 km/h." },
    ],
  },
  { role: "user", content: [{ type: "text", text: "And in m/s?" }] },
];

// The key `app/mastra/model-entry.ts` files the level under for SCCH.
const CALL_OPTIONS = {
  prompt: PROMPT,
  providerOptions: { [SCCH_PROVIDER_NAME]: { reasoningEffort: "medium" } },
};

const model = scchProvider.chatModel("Qwen/Qwen3.8-27B-FP8");

function lastBody(): Record<string, unknown> {
  const call = captured.at(-1);
  expect(call, "no chat/completions request was captured").toBeDefined();
  expect(call?.url).toContain("/chat/completions");
  return call?.body ?? {};
}

/** Every message the body carries, as plain records. */
function messages(body: Record<string, unknown>): Record<string, unknown>[] {
  expect(Array.isArray(body.messages)).toBe(true);
  return body.messages as Record<string, unknown>[];
}

beforeEach(() => {
  captured.length = 0;
});

describe("doGenerate (non-streaming)", () => {
  it("puts the reasoning level on the wire as `reasoning_effort`", async () => {
    await model.doGenerate(CALL_OPTIONS);
    expect(lastBody().reasoning_effort).toBe("medium");
  });

  it("sends NO assistant `reasoning_content` — the history replay is stripped", async () => {
    await model.doGenerate(CALL_OPTIONS);
    const history = messages(lastBody());
    // The assistant turn IS there (only the scratchpad field is gone).
    expect(history.some((message) => message.role === "assistant")).toBe(true);
    for (const message of history) expect(message).not.toHaveProperty("reasoning_content");
  });
});

describe("doStream (the path the chat actually uses)", () => {
  it("opts into stream_options.include_usage (the metering numbers)", async () => {
    await model.doStream(CALL_OPTIONS);
    const body = lastBody();
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("puts the reasoning level on the wire as `reasoning_effort`", async () => {
    await model.doStream(CALL_OPTIONS);
    expect(lastBody().reasoning_effort).toBe("medium");
  });

  it("sends NO assistant `reasoning_content` — the history replay is stripped", async () => {
    await model.doStream(CALL_OPTIONS);
    const history = messages(lastBody());
    expect(history.some((message) => message.role === "assistant")).toBe(true);
    for (const message of history) expect(message).not.toHaveProperty("reasoning_content");
  });
});

describe("without a reasoning level", () => {
  it("omits `reasoning_effort` entirely, leaving the model's own default", async () => {
    await model.doStream({ prompt: PROMPT });
    expect(lastBody()).not.toHaveProperty("reasoning_effort");
  });
});
