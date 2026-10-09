import { describe, expect, it } from "vitest";
import { mastra } from "@/app/mastra";
import { reasoningStrippingProcessor } from "@/app/mastra/reasoning-processor";
import { writingAgent } from "@/app/mastra/writing-agents";

// Invariants over the REAL agent registry (app/mastra/index.ts), so an agent added
// there is covered without being named here. Without DATABASE_URL the registry
// boots on Mastra's in-memory fallback; nothing below runs an agent.

const memoryAgents = Object.entries(mastra.listAgents()).filter(([, agent]) =>
  agent.hasOwnMemory(),
);

describe("memory-backed agents", () => {
  it("include the tutor, the quiz discussion and the writing agent", () => {
    expect(memoryAgents.map(([key]) => key)).toEqual(
      expect.arrayContaining(["tutor", "quizDiscussion", "writing"]),
    );
  });

  // Reasoning is live-only: the processor drops it before memory persists a turn
  // (docs/chat.md), so every agent with memory must carry it.
  it.each(memoryAgents)(
    "%s strips reasoning before persistence in its output processors",
    async (_key, agent) => {
      expect(await agent.listConfiguredOutputProcessors()).toContain(reasoningStrippingProcessor);
    },
  );
});

describe("writing feedback agent", () => {
  // Read-only by construction (docs/writing.md): it cannot edit the student's text.
  it("has no server-side tools and no working-memory tool", async () => {
    expect(await writingAgent.listTools()).toEqual({});
    const memory = await writingAgent.getMemory();
    expect(memory).toBeDefined();
    expect(memory?.listTools()).toEqual({});
  });
});
