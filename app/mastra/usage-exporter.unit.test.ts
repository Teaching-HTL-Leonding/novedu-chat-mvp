import type { AnyExportedSpan, TracingEvent } from "@mastra/core/observability";
import { SpanType } from "@mastra/core/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The usage exporter's pure span→delta mapping (the correctness core) plus the
// exporter object's event gating. The store + telemetry are mocked so the module
// imports without a DB and we can assert the recorded payload.

const mocks = vi.hoisted(() => ({
  recordLlmUsage: vi.fn(),
  recordError: vi.fn(),
}));
vi.mock("@/lib/usage-store", () => ({ recordLlmUsage: mocks.recordLlmUsage }));
vi.mock("@/lib/telemetry", () => ({ recordError: mocks.recordError }));

import { mapSpanToUsage, usageExporter } from "@/app/mastra/usage-exporter";

const RC = { usageCode: "code-1", usageModule: "tutor", usageUserId: "oid-1" };

function span(overrides: Record<string, unknown>): AnyExportedSpan {
  return {
    type: SpanType.MODEL_GENERATION,
    requestContext: RC,
    metadata: {},
    attributes: {},
    ...overrides,
  } as unknown as AnyExportedSpan;
}

const genUsage = (usage: unknown) =>
  span({ type: SpanType.MODEL_GENERATION, attributes: { usage } });

beforeEach(() => vi.clearAllMocks());

describe("mapSpanToUsage — MODEL_GENERATION tokens", () => {
  it("splits input into cached vs new (UsageStats: inputDetails.cacheRead)", () => {
    const mapped = mapSpanToUsage(
      genUsage({ inputTokens: 100, outputTokens: 50, inputDetails: { cacheRead: 30 } }),
    );
    expect(mapped).toMatchObject({
      code: "code-1",
      module: "tutor",
      userId: "oid-1",
      inputCached: 30,
      inputNew: 70,
      output: 50,
      toolCalls: 0,
    });
  });

  it("treats a missing cacheRead as 0 cached, all input new (the SCCH case)", () => {
    const mapped = mapSpanToUsage(genUsage({ inputTokens: 100, outputTokens: 50 }));
    expect(mapped).toMatchObject({ inputCached: 0, inputNew: 100, output: 50 });
  });

  it("returns null when the generation span carries no usage", () => {
    expect(mapSpanToUsage(genUsage(undefined))).toBeNull();
  });

  it("returns null for an all-zero usage payload", () => {
    expect(mapSpanToUsage(genUsage({ inputTokens: 0, outputTokens: 0 }))).toBeNull();
  });

  it("ignores MODEL_STEP spans (only MODEL_GENERATION is counted, no double-count)", () => {
    expect(
      mapSpanToUsage(
        span({ type: SpanType.MODEL_STEP, attributes: { usage: { inputTokens: 9 } } }),
      ),
    ).toBeNull();
  });
});

describe("mapSpanToUsage — provider/model attribution (span attributes)", () => {
  const genWith = (attributes: Record<string, unknown>) =>
    span({ attributes: { usage: { inputTokens: 5, outputTokens: 2 }, ...attributes } });

  it("maps the named ai-sdk provider ids to the app-level labels", () => {
    expect(
      mapSpanToUsage(genWith({ provider: "scch.chat", model: "RedHatAI/gemma-4-31B" })),
    ).toMatchObject({ provider: "SCCH", model: "RedHatAI/gemma-4-31B" });
    expect(
      mapSpanToUsage(genWith({ provider: "azure-foundry.chat", model: "gpt-5.4-mini" })),
    ).toMatchObject({ provider: "Azure Foundry", model: "gpt-5.4-mini" });
    expect(
      mapSpanToUsage(genWith({ provider: "openrouter.chat", model: "z-ai/glm-5.3-flash" })),
    ).toMatchObject({ provider: "OpenRouter", model: "z-ai/glm-5.3-flash" });
  });

  it("passes an unmapped provider id through raw (a naming regression stays visible)", () => {
    expect(mapSpanToUsage(genWith({ provider: "openai.chat", model: "m" }))).toMatchObject({
      provider: "openai.chat",
    });
  });

  it("leaves provider/model undefined when the span lacks them", () => {
    const mapped = mapSpanToUsage(genWith({}));
    expect(mapped?.provider).toBeUndefined();
    expect(mapped?.model).toBeUndefined();
  });

  it("carries no provider/model on tool-call spans (nothing to COALESCE-fill)", () => {
    const mapped = mapSpanToUsage(span({ type: SpanType.TOOL_CALL }));
    expect(mapped?.provider).toBeUndefined();
    expect(mapped?.model).toBeUndefined();
  });
});

describe("mapSpanToUsage — attribution", () => {
  it("reads the keys from metadata when requestContext lacks them", () => {
    const mapped = mapSpanToUsage(
      span({
        requestContext: {},
        metadata: RC,
        attributes: { usage: { inputTokens: 5, outputTokens: 5 } },
      }),
    );
    expect(mapped).toMatchObject({ code: "code-1", module: "tutor", userId: "oid-1" });
  });

  it("returns null without a code or module (cannot attribute usage_by_code)", () => {
    // No attribution keys at all.
    expect(
      mapSpanToUsage(
        span({ requestContext: {}, metadata: {}, attributes: { usage: { inputTokens: 5 } } }),
      ),
    ).toBeNull();
    // Code but no module.
    expect(
      mapSpanToUsage(
        span({ requestContext: { usageCode: "c" }, attributes: { usage: { inputTokens: 5 } } }),
      ),
    ).toBeNull();
  });

  it("maps with userId undefined when only code+module are present (coding-like)", () => {
    const mapped = mapSpanToUsage(
      span({
        requestContext: { usageCode: "c", usageModule: "coding" },
        attributes: { usage: { inputTokens: 5, outputTokens: 2 } },
      }),
    );
    expect(mapped).toMatchObject({ code: "c", module: "coding", inputNew: 5, output: 2 });
    expect(mapped?.userId).toBeUndefined();
  });
});

describe("mapSpanToUsage — tool calls", () => {
  it.each([SpanType.TOOL_CALL, SpanType.CLIENT_TOOL_CALL, SpanType.MCP_TOOL_CALL])(
    "counts +1 tool call with zero tokens for %s",
    (type) => {
      expect(mapSpanToUsage(span({ type }))).toMatchObject({
        code: "code-1",
        toolCalls: 1,
        inputNew: 0,
        output: 0,
      });
    },
  );
});

describe("usageExporter.exportTracingEvent", () => {
  it("records usage on span_ended for a mappable span", async () => {
    const event = {
      type: "span_ended",
      exportedSpan: genUsage({ inputTokens: 10, outputTokens: 4 }),
    } as unknown as TracingEvent;
    await usageExporter.exportTracingEvent(event);
    expect(mocks.recordLlmUsage).toHaveBeenCalledWith(
      expect.objectContaining({ code: "code-1", module: "tutor", inputNew: 10, output: 4 }),
    );
  });

  it("ignores non-span_ended events", async () => {
    const event = {
      type: "span_started",
      exportedSpan: genUsage({ inputTokens: 10, outputTokens: 4 }),
    } as unknown as TracingEvent;
    await usageExporter.exportTracingEvent(event);
    expect(mocks.recordLlmUsage).not.toHaveBeenCalled();
  });

  it("does not record for an unmappable ended span", async () => {
    const event = {
      type: "span_ended",
      exportedSpan: genUsage(undefined),
    } as unknown as TracingEvent;
    await usageExporter.exportTracingEvent(event);
    expect(mocks.recordLlmUsage).not.toHaveBeenCalled();
  });
});
