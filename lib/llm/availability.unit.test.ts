import { beforeEach, describe, expect, it, vi } from "vitest";
import { providerUnavailableReason } from "@/lib/llm/availability";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("providerUnavailableReason", () => {
  it("SCCH is always available (it is the deployment's baseline provider)", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    expect(providerUnavailableReason("SCCH")).toBeNull();
  });

  it("Azure Foundry without AZURE_FOUNDRY_ENDPOINT returns a teacher-readable reason", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    const reason = providerUnavailableReason("Azure Foundry");
    expect(reason).toContain("Azure Foundry");
    expect(reason).toContain("AZURE_FOUNDRY_ENDPOINT");
  });

  it("Azure Foundry with the endpoint configured is available", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "https://res.openai.azure.com");
    expect(providerUnavailableReason("Azure Foundry")).toBeNull();
  });

  it("OpenRouter without OPENROUTER_API_KEY returns a teacher-readable reason", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const reason = providerUnavailableReason("OpenRouter");
    expect(reason).toContain("OpenRouter");
    expect(reason).toContain("OPENROUTER_API_KEY");
  });

  it("OpenRouter with the key configured is available", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    expect(providerUnavailableReason("OpenRouter")).toBeNull();
  });

  it("SCCH stays available even with every optional provider unconfigured", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(providerUnavailableReason("SCCH")).toBeNull();
  });
});
