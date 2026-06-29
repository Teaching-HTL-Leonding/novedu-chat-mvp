import { describe, expect, it } from "vitest";
import { buildLittleCoderConfig } from "@/lib/little-coder-config";

// The shared little-coder `models.json` builder — the single source of truth for the
// connection block AND the /codes list copy button, so it must keep the exact shape
// little-coder expects.

describe("buildLittleCoderConfig", () => {
  it("builds the little-coder provider config with the given connection values", () => {
    const json = buildLittleCoderConfig({
      baseUrl: "https://app.example/api/coding/v1",
      apiKey: "z1yxblebm2",
      modelId: "coding",
      modelName: "Novedu coding",
    });
    const cfg = JSON.parse(json);
    const provider = cfg.providers.novedu;
    expect(provider.api).toBe("openai-completions");
    expect(provider.baseUrl).toBe("https://app.example/api/coding/v1");
    expect(provider.apiKey).toBe("z1yxblebm2");
    expect(provider.models).toHaveLength(1);
    expect(provider.models[0]).toMatchObject({
      id: "coding",
      name: "Novedu coding",
      reasoning: false,
      input: ["text"],
      contextWindow: 32768,
      maxTokens: 4096,
    });
  });

  it("is pretty-printed (ready to paste)", () => {
    const json = buildLittleCoderConfig({
      baseUrl: "b",
      apiKey: "k",
      modelId: "coding",
      modelName: "n",
    });
    expect(json).toContain("\n");
    expect(json).toContain('  "providers"');
  });
});
