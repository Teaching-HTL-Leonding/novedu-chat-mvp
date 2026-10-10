import { beforeEach, describe, expect, it, vi } from "vitest";

// app/mastra/scch.ts runs a top-level model-discovery fetch on import — replace it
// with an equivalently-named provider so this test never touches the network. Only
// the NAME matters here (it is the metering contract asserted below); the real
// provider's option flags are guarded in app/mastra/scch.unit.test.ts.
// `stripAssistantReasoning` is re-exported by the same module for the OpenRouter
// provider built in lib/llm/model.ts; its behaviour is guarded there too.
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
    stripAssistantReasoning: (args: Record<string, unknown>) => args,
  };
});

// Only the Entra token is replaced; the URL getters stay real.
vi.mock("@/lib/llm/foundry-endpoint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/foundry-endpoint")>()),
  foundryBearerToken: async () => "entra-test-token",
}));

import { reasoningOptionsKey, resolveLanguageModel } from "@/lib/llm/model";
import {
  OPENROUTER_PROVIDER_NAME,
  providerFromModelProviderId,
  SCCH_PROVIDER_NAME,
} from "@/lib/llm/provider";

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

  it("OpenRouter → a chat model on the lazily-built OpenRouter provider", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const model = resolveLanguageModel("OpenRouter", "z-ai/glm-5.3-flash");
    expect(model.modelId).toBe("z-ai/glm-5.3-flash");
    // Same metering contract as SCCH — `<instance name>.chat`, mapped back by the
    // usage exporter (lib/llm/provider.ts).
    expect(model.provider).toBe("openrouter.chat");
    expect(providerFromModelProviderId(model.provider)).toBe("OpenRouter");
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

  it("OpenRouter → its own ai-sdk INSTANCE NAME (the second openai-compatible instance)", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    expect(reasoningOptionsKey("OpenRouter")).toBe(OPENROUTER_PROVIDER_NAME);
    expect(resolveLanguageModel("OpenRouter", "m").provider).toBe(
      `${reasoningOptionsKey("OpenRouter")}.chat`,
    );
  });
});

// The wire contract of the two lazily-built providers, observed in the request the
// package finally sends — only the HTTP call is stubbed (the SCCH counterpart is
// app/mastra/scch.wire.unit.test.ts).
describe("agent-path requests", () => {
  const PROMPT = [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }];
  let requests: { headers: Headers; body: Record<string, unknown> }[];

  beforeEach(() => {
    requests = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    });
  });

  it("Azure Foundry authenticates with the Entra bearer from foundry-endpoint and sends no api-key header", async () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "https://res.openai.azure.com/");
    await resolveLanguageModel("Azure Foundry", "gpt-5.4-mini").doStream({ prompt: PROMPT });
    expect(requests).toHaveLength(1);
    const headers = requests[0]?.headers;
    expect(headers?.get("authorization")).toBe("Bearer entra-test-token");
    expect(headers?.has("api-key")).toBe(false);
  });

  it.each([
    ["Azure Foundry", "gpt-5.4-mini"],
    ["OpenRouter", "z-ai/glm-5.3-flash"],
  ] as const)("%s streaming requests ask for usage (metering reads it)", async (provider, id) => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "https://res.openai.azure.com/");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    await resolveLanguageModel(provider, id).doStream({ prompt: PROMPT });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.stream).toBe(true);
    expect(requests[0]?.body.stream_options).toEqual({ include_usage: true });
  });
});
