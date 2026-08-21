import { describe, expect, it, vi } from "vitest";

// app/mastra/scch.ts runs a top-level model-discovery fetch on import — replace it
// with an equivalently-named provider so this test never touches the network. Only
// the NAME matters here (it is the metering contract asserted below); the real
// provider's option flags are guarded in app/mastra/scch.unit.test.ts.
vi.mock("@/app/mastra/scch", async () => {
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const { SCCH_PROVIDER_NAME } = await import("@/lib/llm/provider");
  return {
    scchProvider: createOpenAICompatible({
      name: SCCH_PROVIDER_NAME,
      baseURL: "https://scch.test/v1",
      apiKey: "sk-test",
      includeUsage: true,
    }),
  };
});

import { reasoningOptionsKey, resolveLanguageModel } from "@/lib/llm/model";
import { providerFromModelProviderId, SCCH_PROVIDER_NAME } from "@/lib/llm/provider";

describe("resolveLanguageModel", () => {
  it("SCCH → a chat model on the SCCH provider, carrying the metering name", () => {
    const model = resolveLanguageModel("SCCH", "Qwen/Qwen3.6-27B-FP8");
    expect(model.modelId).toBe("Qwen/Qwen3.6-27B-FP8");
    // `provider` is what Mastra stamps on MODEL_GENERATION spans — the exporter
    // maps it back via providerFromModelProviderId (lib/llm/provider.ts). The
    // METERING GUARD on the @ai-sdk/openai → @ai-sdk/openai-compatible swap: the
    // id must stay `scch.chat` (openai-compatible's `.chatModel()` names its
    // models `<name>.chat`).
    expect(model.provider).toBe("scch.chat");
    expect(providerFromModelProviderId(model.provider)).toBe("SCCH");
  });

  it("Azure Foundry → a chat model on the lazily-built Foundry provider", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "https://res.openai.azure.com/");
    const model = resolveLanguageModel("Azure Foundry", "gpt-5.4-mini");
    expect(model.modelId).toBe("gpt-5.4-mini");
    expect(model.provider).toBe("azure-foundry.chat");
  });
});

// The other half of the package choice: WHERE per-request options must be filed
// so the resolved model actually reads them. A wrong key is silent — the option
// is simply forwarded as an unknown body field or dropped — so it is asserted
// against the same constants the providers are built from. `app/mastra/
// model-entry.ts` owns only the placement (its own suite).
describe("reasoningOptionsKey", () => {
  it("SCCH → the ai-sdk INSTANCE NAME (@ai-sdk/openai-compatible's convention)", () => {
    expect(reasoningOptionsKey("SCCH")).toBe(SCCH_PROVIDER_NAME);
    // The same instance name that yields the `scch.chat` metering id above.
    expect(resolveLanguageModel("SCCH", "m").provider).toBe(`${reasoningOptionsKey("SCCH")}.chat`);
  });

  it('Azure Foundry → the FIXED "openai" key (@ai-sdk/openai ignores the instance name)', () => {
    expect(reasoningOptionsKey("Azure Foundry")).toBe("openai");
  });
});
