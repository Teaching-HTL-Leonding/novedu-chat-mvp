import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_PROVIDER,
  parseLenientProvider,
  providerFromModelProviderId,
  providerSchema,
} from "@/lib/llm/provider";

describe("providerSchema", () => {
  // Embedded the way every activity schema uses it: `llm: z.strictObject({ ..., provider })`.
  const llm = z.strictObject({ model: z.string(), provider: providerSchema });

  it("defaults a missing provider to SCCH", () => {
    expect(llm.parse({ model: "m" }).provider).toBe("SCCH");
    expect(DEFAULT_PROVIDER).toBe("SCCH");
  });

  it("accepts every supported literal", () => {
    expect(llm.parse({ model: "m", provider: "SCCH" }).provider).toBe("SCCH");
    expect(llm.parse({ model: "m", provider: "Azure Foundry" }).provider).toBe("Azure Foundry");
    expect(llm.parse({ model: "m", provider: "OpenRouter" }).provider).toBe("OpenRouter");
  });

  it("rejects unknown values (including wrong casing)", () => {
    expect(llm.safeParse({ model: "m", provider: "azure foundry" }).success).toBe(false);
    expect(llm.safeParse({ model: "m", provider: "openrouter" }).success).toBe(false);
    expect(llm.safeParse({ model: "m", provider: "OpenAI" }).success).toBe(false);
    expect(llm.safeParse({ model: "m", provider: 42 }).success).toBe(false);
  });
});

describe("providerFromModelProviderId", () => {
  it("maps the named ai-sdk provider ids back to their LlmProvider", () => {
    expect(providerFromModelProviderId("scch.chat")).toBe("SCCH");
    expect(providerFromModelProviderId("azure-foundry.chat")).toBe("Azure Foundry");
    expect(providerFromModelProviderId("openrouter.chat")).toBe("OpenRouter");
  });

  it("returns undefined for foreign or missing ids", () => {
    expect(providerFromModelProviderId("openai.chat")).toBeUndefined();
    expect(providerFromModelProviderId("")).toBeUndefined();
    expect(providerFromModelProviderId(undefined)).toBeUndefined();
  });
});

describe("parseLenientProvider", () => {
  it("passes valid literals through", () => {
    expect(parseLenientProvider("SCCH")).toBe("SCCH");
    expect(parseLenientProvider("Azure Foundry")).toBe("Azure Foundry");
    expect(parseLenientProvider("OpenRouter")).toBe("OpenRouter");
  });

  it("returns undefined for anything else (caller decides missing vs. invalid)", () => {
    expect(parseLenientProvider(undefined)).toBeUndefined();
    expect(parseLenientProvider(null)).toBeUndefined();
    expect(parseLenientProvider("scch")).toBeUndefined();
    expect(parseLenientProvider("openrouter")).toBeUndefined();
    expect(parseLenientProvider({ provider: "SCCH" })).toBeUndefined();
  });
});
