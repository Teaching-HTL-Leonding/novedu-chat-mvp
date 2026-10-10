import { describe, expect, it } from "vitest";
import { LIMITS, type LimitsConfig } from "./config";
import { chatMaxInputChars, chatMaxOutputTokens, codingMaxOutputTokens } from "./resolve";

const config: LimitsConfig = {
  ...LIMITS,
  defaults: { ...LIMITS.defaults, chatMaxOutputTokens: 1_000, codingMaxOutputTokens: 2_000 },
  providers: {
    SCCH: { budgetWeight: 0 },
    "Azure Foundry": { budgetWeight: 1, chatMaxOutputTokens: 500, codingMaxOutputTokens: 700 },
    OpenRouter: { budgetWeight: 1 },
  },
};

describe("limit resolvers", () => {
  it("fall back to the defaults when the provider sets nothing", () => {
    expect(chatMaxOutputTokens("SCCH", config)).toBe(1_000);
    expect(codingMaxOutputTokens("OpenRouter", config)).toBe(2_000);
  });

  it("prefer the provider's own value over the default", () => {
    expect(chatMaxOutputTokens("Azure Foundry", config)).toBe(500);
    expect(codingMaxOutputTokens("Azure Foundry", config)).toBe(700);
  });

  it("read the shipped config by default", () => {
    expect(chatMaxOutputTokens("SCCH")).toBe(LIMITS.defaults.chatMaxOutputTokens);
    expect(codingMaxOutputTokens("SCCH")).toBe(LIMITS.defaults.codingMaxOutputTokens);
    expect(chatMaxInputChars()).toBe(LIMITS.defaults.chatMaxInputChars);
  });
});
