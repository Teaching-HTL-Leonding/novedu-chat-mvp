import { describe, expect, it, vi } from "vitest";

// The agent path's reasoning-effort seam: `modelEntry` returns Mastra's array form
// and files the level under the key `reasoningOptionsKey` names. WHICH key each
// provider needs is @ai-sdk package trivia asserted next to the package choice
// (lib/llm/model.unit.test.ts); here the lookup is stubbed with a sentinel, so
// these tests fail only when the PLACEMENT is wrong. Both are mocked anyway
// because the real module imports app/mastra/scch.ts, whose top-level model
// discovery would hit the network.
const resolveLanguageModel = vi.hoisted(() => vi.fn(() => "resolved-model"));
const reasoningOptionsKey = vi.hoisted(() => vi.fn((_provider: string) => "provider-key"));
vi.mock("@/lib/llm/model", () => ({ resolveLanguageModel, reasoningOptionsKey }));

import { modelEntry } from "@/app/mastra/model-entry";

describe("modelEntry", () => {
  it("returns the ModelWithRetries ARRAY form (the only shape carrying providerOptions)", () => {
    const entries = modelEntry("SCCH", "Qwen/Qwen3.8-27B-FP8");
    expect(entries).toEqual([{ model: "resolved-model" }]);
    expect(resolveLanguageModel).toHaveBeenCalledWith("SCCH", "Qwen/Qwen3.8-27B-FP8");
  });

  it("omits providerOptions entirely without a reasoning level (model's own default)", () => {
    expect(modelEntry("Azure Foundry", "gpt-5.4-mini")[0]).not.toHaveProperty("providerOptions");
    expect(reasoningOptionsKey).not.toHaveBeenCalled();
  });

  it("files the level as `reasoningEffort` under the provider's own options key", () => {
    expect(modelEntry("SCCH", "Qwen/Qwen3.8-27B-FP8", "medium")).toEqual([
      {
        model: "resolved-model",
        providerOptions: { "provider-key": { reasoningEffort: "medium" } },
      },
    ]);
    expect(reasoningOptionsKey).toHaveBeenCalledWith("SCCH");
  });

  it("asks for the key of the provider it was handed, never a fixed one", () => {
    modelEntry("Azure Foundry", "gpt-5.4-mini", "high");
    expect(reasoningOptionsKey).toHaveBeenCalledWith("Azure Foundry");
  });
});
