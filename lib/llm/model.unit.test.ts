import { describe, expect, it, vi } from "vitest";

// app/mastra/scch.ts runs a top-level model-discovery fetch on import — replace it
// with an equivalently-named provider so this test never touches the network.
vi.mock("@/app/mastra/scch", async () => {
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { SCCH_PROVIDER_NAME } = await import("@/lib/llm/provider");
  return {
    scchProvider: createOpenAI({
      name: SCCH_PROVIDER_NAME,
      baseURL: "https://scch.test/v1",
      apiKey: "sk-test",
    }),
  };
});

import { resolveLanguageModel } from "@/lib/llm/model";

describe("resolveLanguageModel", () => {
  it("SCCH → a chat model on the SCCH provider, carrying the metering name", () => {
    const model = resolveLanguageModel("SCCH", "Qwen/Qwen3.6-27B-FP8");
    expect(model.modelId).toBe("Qwen/Qwen3.6-27B-FP8");
    // `provider` is what Mastra stamps on MODEL_GENERATION spans — the exporter
    // maps it back via providerFromModelProviderId (lib/llm/provider.ts).
    expect(model.provider).toBe("scch.chat");
  });

  it("Azure Foundry → a chat model on the lazily-built Foundry provider", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "https://res.openai.azure.com/");
    const model = resolveLanguageModel("Azure Foundry", "gpt-5.4-mini");
    expect(model.modelId).toBe("gpt-5.4-mini");
    expect(model.provider).toBe("azure-foundry.chat");
  });
});
