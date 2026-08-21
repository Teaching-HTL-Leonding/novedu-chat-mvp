import { describe, expect, it, vi } from "vitest";

// Two flags on the SCCH provider are silent-failure seams: @ai-sdk/openai-compatible
// supplies both behaviours only on request, and dropping either degrades the app with
// NO error — no token usage (metering), or a schema-less `{type: "json_object"}` on the
// wire (the quiz grader / eval routes). Hence this guard on how the provider is
// CONSTRUCTED; app/mastra/scch.wire.unit.test.ts proves the same properties end up in
// the real request body. See docs/ai-models.md, "Two ai-sdk packages".
const createOpenAICompatible = vi.hoisted(() =>
  vi.fn((_options: Record<string, unknown>) => ({ chatModel: vi.fn() })),
);
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible }));

// scch.ts runs a top-level model-discovery fetch on import; an empty base URL makes it
// bail before any network call (its own env guard), so this stays hermetic.
vi.hoisted(() => {
  process.env.SCCH_BASE_URL = "";
  process.env.SCCH_API_KEY = "";
});

import "@/app/mastra/scch";
import { SCCH_PROVIDER_NAME } from "@/lib/llm/provider";

describe("scchProvider", () => {
  const options = createOpenAICompatible.mock.lastCall?.[0] ?? {};

  it("is built with the metering-contract name", () => {
    expect(options.name).toBe(SCCH_PROVIDER_NAME);
  });

  it("opts into stream_options.include_usage (metering reads usage off the span)", () => {
    expect(options.includeUsage).toBe(true);
  });

  it("opts into structured outputs (vLLM honors response_format: json_schema)", () => {
    expect(options.supportsStructuredOutputs).toBe(true);
  });
});

// The outgoing-history guard: @ai-sdk/openai-compatible replays a previous turn's
// thinking as `reasoning_content` on assistant history messages, which makes gemma
// answer into `reasoning_content` after a tool call — leaving the visible reply EMPTY.
// See docs/ai-models.md, "Two ai-sdk packages".
describe("transformRequestBody", () => {
  const transform = createOpenAICompatible.mock.lastCall?.[0].transformRequestBody as (
    args: Record<string, unknown>,
  ) => Record<string, unknown>;

  const body = {
    model: "RedHatAI/gemma-4-31B-it-FP8-Dynamic",
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: "You are a tutor." },
      { role: "user", content: "Give me a random number." },
      {
        role: "assistant",
        content: null,
        reasoning_content: "The user wants a random number, so I should call the tool.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "random_number", arguments: '{"min":1,"max":9}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "426267" },
      { role: "assistant", content: "Your number is 426267." },
    ],
  };

  it("strips reasoning_content from assistant history messages", () => {
    const out = transform(structuredClone(body));
    const messages = out.messages as Record<string, unknown>[];
    for (const message of messages) expect(message).not.toHaveProperty("reasoning_content");
  });

  it("leaves every other field byte-identical", () => {
    const out = transform(structuredClone(body));
    const { reasoning_content: _dropped, ...toolCallTurn } = body.messages[2] as Record<
      string,
      unknown
    >;
    expect(out).toEqual({
      ...body,
      messages: [
        body.messages[0],
        body.messages[1],
        toolCallTurn,
        body.messages[3],
        body.messages[4],
      ],
    });
  });

  it("does not mutate the body it was handed", () => {
    const input = structuredClone(body);
    transform(input);
    expect(input).toEqual(body);
  });

  it("passes a body with no messages through unchanged", () => {
    const bare = { model: "m" };
    expect(transform(bare)).toEqual(bare);
  });
});
