import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBearerTokenProvider: vi.fn(),
}));

// Only the token-provider factory is mocked; the credential constructors stay
// real (constructing them does no I/O — tokens are only fetched on getToken()).
vi.mock("@azure/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@azure/identity")>();
  return { ...actual, getBearerTokenProvider: mocks.getBearerTokenProvider };
});

import {
  foundryChatCompletionsUrl,
  foundryModelsUrl,
  foundryV1Base,
} from "@/lib/llm/foundry-endpoint";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("foundry URL builders", () => {
  it("appends /openai/v1 to the bare resource endpoint", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "https://res.openai.azure.com");
    expect(foundryV1Base()).toBe("https://res.openai.azure.com/openai/v1");
    expect(foundryChatCompletionsUrl()).toBe(
      "https://res.openai.azure.com/openai/v1/chat/completions",
    );
    expect(foundryModelsUrl()).toBe("https://res.openai.azure.com/openai/v1/models");
  });

  it("tolerates trailing slashes on the configured endpoint", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "https://res.openai.azure.com//");
    expect(foundryV1Base()).toBe("https://res.openai.azure.com/openai/v1");
  });

  it("throws a clear error when AZURE_FOUNDRY_ENDPOINT is not set", () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    expect(() => foundryV1Base()).toThrow("AZURE_FOUNDRY_ENDPOINT is not set");
  });
});

describe("foundryBearerToken", () => {
  it("creates ONE token provider for the process and reuses it per call", async () => {
    // Fresh module registry so this test owns the module-level singleton.
    vi.resetModules();
    mocks.getBearerTokenProvider.mockReturnValue(vi.fn().mockResolvedValue("entra-token"));
    const { foundryBearerToken } = await import("@/lib/llm/foundry-endpoint");

    await expect(foundryBearerToken()).resolves.toBe("entra-token");
    await expect(foundryBearerToken()).resolves.toBe("entra-token");

    expect(mocks.getBearerTokenProvider).toHaveBeenCalledTimes(1);
    expect(mocks.getBearerTokenProvider).toHaveBeenCalledWith(
      expect.anything(),
      "https://cognitiveservices.azure.com/.default",
    );
  });

  it("bounds a hung acquisition with a timeout instead of stalling the caller", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    try {
      // A provider whose token promise never settles — a stuck `az` subprocess.
      mocks.getBearerTokenProvider.mockReturnValue(() => new Promise<never>(() => {}));
      const { foundryBearerToken, FOUNDRY_TOKEN_TIMEOUT_MS } = await import(
        "@/lib/llm/foundry-endpoint"
      );

      const hung = foundryBearerToken();
      const assertion = expect(hung).rejects.toThrow(
        `Entra token acquisition timed out after ${FOUNDRY_TOKEN_TIMEOUT_MS} ms`,
      );
      await vi.advanceTimersByTimeAsync(FOUNDRY_TOKEN_TIMEOUT_MS);
      await assertion;
      expect(mocks.getBearerTokenProvider).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
