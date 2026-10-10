import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it, vi } from "vitest";

const emitEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telemetry", () => ({ emitEvent }));

import { chatMaxOutputTokens } from "@/lib/limits/resolve";
import { USAGE_MODULE } from "@/lib/usage-context-keys";
import {
  chatOutputLimitOptions,
  hitOutputCap,
  LIMITS_EXEMPT,
  OUTPUT_TRUNCATED_EVENT,
} from "./output-limit";

function context(entries: Record<string, unknown> = {}): RequestContext {
  const ctx = new RequestContext();
  for (const [key, value] of Object.entries(entries)) ctx.set(key, value);
  return ctx;
}

type FinishArg = Parameters<NonNullable<ReturnType<typeof chatOutputLimitOptions>["onFinish"]>>[0];
const finish = (event: Record<string, unknown>) => event as unknown as FinishArg;

describe("chatOutputLimitOptions", () => {
  it.each(["SCCH", "Azure Foundry", "OpenRouter"] as const)(
    "caps a student's reply at the %s limit",
    (provider) => {
      const options = chatOutputLimitOptions(context({ [LIMITS_EXEMPT]: false }), provider);
      expect(options.modelSettings?.maxOutputTokens).toBe(chatMaxOutputTokens(provider));
    },
  );

  it("FAILS CLOSED: caps when the exemption key is absent", () => {
    const options = chatOutputLimitOptions(context(), "SCCH");
    expect(options.modelSettings?.maxOutputTokens).toBe(chatMaxOutputTokens("SCCH"));
  });

  it("FAILS CLOSED: caps for a truthy non-boolean exemption value", () => {
    const options = chatOutputLimitOptions(context({ [LIMITS_EXEMPT]: "true" }), "SCCH");
    expect(options.modelSettings?.maxOutputTokens).toBe(chatMaxOutputTokens("SCCH"));
  });

  it("returns no options at all for an exempt caller", () => {
    expect(chatOutputLimitOptions(context({ [LIMITS_EXEMPT]: true }), "SCCH")).toEqual({});
  });

  it("emits a content-free event when the reply was cut off", async () => {
    const options = chatOutputLimitOptions(context({ [USAGE_MODULE]: "tutor" }), "OpenRouter");
    await options.onFinish?.(finish({ finishReason: "length", text: "SECRET REPLY", steps: [] }));
    expect(emitEvent).toHaveBeenCalledWith(OUTPUT_TRUNCATED_EVENT, {
      module: "tutor",
      provider: "OpenRouter",
      maxOutputTokens: chatMaxOutputTokens("OpenRouter"),
    });
    expect(JSON.stringify(emitEvent.mock.calls)).not.toContain("SECRET REPLY");
  });

  it("emits nothing for a reply that finished normally", async () => {
    const options = chatOutputLimitOptions(context(), "SCCH");
    await options.onFinish?.(finish({ finishReason: "stop", steps: [] }));
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

describe("hitOutputCap", () => {
  it("is true for a final length finish", () => {
    expect(hitOutputCap({ finishReason: "length" })).toBe(true);
  });

  it("is true when an earlier step hit the cap", () => {
    expect(
      hitOutputCap({
        finishReason: "stop",
        steps: [{ finishReason: "length" }, { finishReason: "stop" }],
      }),
    ).toBe(true);
  });

  it("is false otherwise", () => {
    expect(hitOutputCap({ finishReason: "stop", steps: [{ finishReason: "tool-calls" }] })).toBe(
      false,
    );
    expect(hitOutputCap({})).toBe(false);
  });
});
