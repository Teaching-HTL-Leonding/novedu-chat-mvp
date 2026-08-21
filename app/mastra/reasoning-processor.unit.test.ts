// @vitest-environment node

import type { MastraDBMessage } from "@mastra/core/memory";
import type { ProcessOutputResultArgs } from "@mastra/core/processors";
import { describe, expect, it } from "vitest";
import { reasoningStrippingProcessor } from "./reasoning-processor";

// The persistence half of the reasoning rule (docs/chat.md): a thinking model's
// scratchpad is live-only and must never reach `mastra_messages`. The processor
// is a pure message transform — no Mastra runtime, no storage, no model — so it
// is driven here with plain message objects.

function run(messages: MastraDBMessage[]): MastraDBMessage[] {
  return reasoningStrippingProcessor.processOutputResult({
    messages,
  } as unknown as ProcessOutputResultArgs) as MastraDBMessage[];
}

/** An assistant turn as a thinking model produces it: reasoning, then the answer. */
function thinkingTurn(): MastraDBMessage {
  return {
    id: "m1",
    role: "assistant",
    createdAt: new Date("2026-06-10T10:00:00Z"),
    threadId: "t1",
    resourceId: "abc123",
    content: {
      format: 2,
      parts: [
        { type: "step-start" },
        { type: "reasoning", reasoning: "120 / 1.5 = 80", details: [] },
        { type: "text", text: "80 km/h." },
      ],
      reasoning: "120 / 1.5 = 80",
      metadata: { keep: "me" },
    },
  } as unknown as MastraDBMessage;
}

const userTurn = {
  id: "m0",
  role: "user",
  createdAt: new Date("2026-06-10T09:59:00Z"),
  content: { format: 2, parts: [{ type: "text", text: "How fast?" }] },
} as unknown as MastraDBMessage;

describe("reasoningStrippingProcessor", () => {
  it("removes the reasoning PARTS from an assistant turn", () => {
    const [stripped] = run([thinkingTurn()]);
    expect(stripped?.content.parts.map((part) => part.type)).toEqual(["step-start", "text"]);
  });

  it("removes the flattened content.reasoning string too", () => {
    const [stripped] = run([thinkingTurn()]);
    expect(stripped?.content).not.toHaveProperty("reasoning");
  });

  it("changes NOTHING else — every other field and part survives verbatim", () => {
    const original = thinkingTurn();
    const [stripped] = run([original]);
    const expected = {
      ...original,
      content: {
        format: 2,
        parts: [{ type: "step-start" }, { type: "text", text: "80 km/h." }],
        metadata: { keep: "me" },
      },
    };
    expect(stripped).toEqual(expected);
  });

  it("does not mutate the message it was handed", () => {
    const original = thinkingTurn();
    const before = structuredClone(original);
    run([original]);
    expect(original).toEqual(before);
  });

  it("passes a turn with no reasoning through as the SAME object", () => {
    const answerOnly = {
      id: "m2",
      role: "assistant",
      createdAt: new Date(),
      content: { format: 2, parts: [{ type: "text", text: "Plain answer." }] },
    } as unknown as MastraDBMessage;
    expect(run([answerOnly])[0]).toBe(answerOnly);
    expect(run([userTurn])[0]).toBe(userTurn);
  });

  it("keeps every message, in order", () => {
    const turn = thinkingTurn();
    const out = run([userTurn, turn]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(userTurn);
    expect(out[1]?.id).toBe("m1");
  });
});
