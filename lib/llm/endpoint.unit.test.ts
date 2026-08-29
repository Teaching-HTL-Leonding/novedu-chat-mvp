import { beforeEach, describe, expect, it, vi } from "vitest";

// The Foundry side is mocked so no credential/token machinery runs; the SCCH and
// OpenRouter sides stay real (both `*-endpoint` modules are pure env reading).
vi.mock("@/lib/llm/foundry-endpoint", () => ({
  foundryBearerToken: vi.fn().mockResolvedValue("entra-token"),
  foundryChatCompletionsUrl: () => "https://res.openai.azure.com/openai/v1/chat/completions",
}));

import { resolveChatEndpoint } from "@/lib/llm/endpoint";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveChatEndpoint", () => {
  it("SCCH → the SCCH chat URL with the static Bearer key", async () => {
    vi.stubEnv("SCCH_BASE_URL", "https://scch.test/v1");
    vi.stubEnv("SCCH_API_KEY", "sk-test");
    const endpoint = resolveChatEndpoint("SCCH");
    expect(endpoint.url).toBe("https://scch.test/v1/chat/completions");
    await expect(endpoint.authHeader()).resolves.toBe("Bearer sk-test");
  });

  it("Azure Foundry → the Foundry v1 chat URL with the awaited Entra bearer", async () => {
    const endpoint = resolveChatEndpoint("Azure Foundry");
    expect(endpoint.url).toBe("https://res.openai.azure.com/openai/v1/chat/completions");
    await expect(endpoint.authHeader()).resolves.toBe("Bearer entra-token");
  });

  it("SCCH throws (for the route's 500 path) when the env is missing", () => {
    vi.stubEnv("SCCH_BASE_URL", "");
    expect(() => resolveChatEndpoint("SCCH")).toThrow("SCCH_BASE_URL is not set");
  });

  it("OpenRouter → the public chat URL with the static Bearer key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const endpoint = resolveChatEndpoint("OpenRouter");
    expect(endpoint.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    await expect(endpoint.authHeader()).resolves.toBe("Bearer sk-or-test");
  });

  it("OpenRouter honors an OPENROUTER_BASE_URL override", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://gateway.test/v1");
    expect(resolveChatEndpoint("OpenRouter").url).toBe("https://gateway.test/v1/chat/completions");
  });

  it("OpenRouter's authHeader rejects (for the route's 500 path) when the key is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(resolveChatEndpoint("OpenRouter").authHeader()).rejects.toThrow(
      "OPENROUTER_API_KEY is not set",
    );
  });
});

describe("adaptBody", () => {
  it("SCCH is the identity — the classic dialect passes through untouched", () => {
    vi.stubEnv("SCCH_BASE_URL", "https://scch.test/v1");
    vi.stubEnv("SCCH_API_KEY", "sk-test");
    const body = { max_tokens: 900, temperature: 0.2, top_p: 0.9, stream: true };
    expect(resolveChatEndpoint("SCCH").adaptBody(body)).toBe(body);
  });

  it("OpenRouter is the identity too — it normalizes the classic dialect itself", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const body = { max_tokens: 900, temperature: 0.2, top_p: 0.9, stream: true };
    const out = resolveChatEndpoint("OpenRouter").adaptBody(body);
    expect(out).toBe(body);
    expect(out).toHaveProperty("max_tokens", 900);
    expect(out).not.toHaveProperty("max_completion_tokens");
    expect(out).toHaveProperty("temperature", 0.2);
  });

  it("Foundry renames max_tokens to max_completion_tokens", () => {
    const out = resolveChatEndpoint("Azure Foundry").adaptBody({ max_tokens: 900, stream: false });
    expect(out).toEqual({ max_completion_tokens: 900, stream: false });
  });

  it("Foundry keeps a client-sent max_completion_tokens and drops the stale max_tokens", () => {
    const out = resolveChatEndpoint("Azure Foundry").adaptBody({
      max_tokens: 900,
      max_completion_tokens: 400,
    });
    expect(out).toEqual({ max_completion_tokens: 400 });
  });

  it("Foundry strips temperature and top_p (gpt-5.x reasoning deployments reject them)", () => {
    const out = resolveChatEndpoint("Azure Foundry").adaptBody({
      temperature: 0.2,
      top_p: 0.9,
      tools: [{ type: "function" }],
    });
    expect(out).toEqual({ tools: [{ type: "function" }] });
  });

  it("Foundry passes reasoning_effort through untouched (the proxy's pin must survive)", () => {
    const out = resolveChatEndpoint("Azure Foundry").adaptBody({
      max_tokens: 900,
      temperature: 0.2,
      reasoning_effort: "high",
    });
    expect(out).toEqual({ max_completion_tokens: 900, reasoning_effort: "high" });
  });

  it("Foundry returns a dialect-clean body untouched", () => {
    const body = { messages: [], stream: true };
    expect(resolveChatEndpoint("Azure Foundry").adaptBody(body)).toBe(body);
  });

  it("Foundry never touches stream/stream_options — the usage-tap contract", () => {
    const out = resolveChatEndpoint("Azure Foundry").adaptBody({
      max_tokens: 128,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(out).toEqual({
      max_completion_tokens: 128,
      stream: true,
      stream_options: { include_usage: true },
    });
  });
});
