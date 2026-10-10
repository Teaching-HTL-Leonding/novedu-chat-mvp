import { describe, expect, it } from "vitest";
import { LLM_PROVIDERS } from "@/lib/llm/provider";
import { LIMITS, limitsConfigSchema } from "./config";

describe("limits config", () => {
  it("the shipped config passes its own schema", () => {
    expect(limitsConfigSchema.safeParse(LIMITS).success).toBe(true);
  });

  it("every LLM provider has a limits entry", () => {
    for (const provider of LLM_PROVIDERS) {
      expect(LIMITS.providers[provider], provider).toBeDefined();
    }
  });

  it("SCCH is free for the daily budget, paid providers are not", () => {
    expect(LIMITS.providers.SCCH.budgetWeight).toBe(0);
    expect(LIMITS.providers["Azure Foundry"].budgetWeight).toBeGreaterThan(0);
    expect(LIMITS.providers.OpenRouter.budgetWeight).toBeGreaterThan(0);
  });

  it("rejects a non-positive limit", () => {
    const broken = { ...LIMITS, defaults: { ...LIMITS.defaults, chatMaxOutputTokens: 0 } };
    expect(limitsConfigSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a non-integer token limit", () => {
    const broken = { ...LIMITS, defaults: { ...LIMITS.defaults, chatMaxInputChars: 10.5 } };
    expect(limitsConfigSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unknown key (a typo must not be silently ignored)", () => {
    const broken = { ...LIMITS, defaults: { ...LIMITS.defaults, chatMaxOutputToken: 1 } };
    expect(limitsConfigSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a negative provider budget weight", () => {
    const broken = {
      ...LIMITS,
      providers: { ...LIMITS.providers, OpenRouter: { budgetWeight: -1 } },
    };
    expect(limitsConfigSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a default output cap above its ceiling", () => {
    const broken = {
      ...LIMITS,
      defaults: {
        ...LIMITS.defaults,
        chatMaxOutputTokens: 20_000,
        chatMaxOutputTokensCeiling: 16_000,
      },
    };
    expect(limitsConfigSchema.safeParse(broken).success).toBe(false);
  });
});
