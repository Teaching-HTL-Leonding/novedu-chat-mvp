import { beforeEach, describe, expect, it, vi } from "vitest";

// The tutor agent's per-request configuration: both resolvers (instructions +
// model) share one request-scoped build of the tutor YAML, and the MODEL resolver
// applies the code's LLM override pair from the request context over the YAML's
// llm values, gating availability on the EFFECTIVE provider. The Mastra classes
// and the tutor loader are mocked; the availability gate
// (providerUnavailableReason) stays real, driven via the env.

const loadAndBuildTutorPrompt = vi.hoisted(() => vi.fn());
const resolveLanguageModel = vi.hoisted(() => vi.fn());

// Capture the Agent config instead of building a real Mastra agent.
vi.mock("@mastra/core/agent", () => ({
  Agent: class {
    config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
  },
}));
vi.mock("@mastra/memory", () => ({ Memory: class {} }));
vi.mock("@/lib/tutors", () => ({ loadAndBuildTutorPrompt }));
vi.mock("@/lib/prompt-fragments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prompt-fragments")>()),
  defaultFetcher: {},
}));
vi.mock("@/lib/llm/model", () => ({ resolveLanguageModel }));

import {
  TUTOR_MODEL_OVERRIDE,
  TUTOR_PROVIDER_OVERRIDE,
  TUTOR_URL,
  tutorAgent,
} from "@/app/mastra/tutor-agent";

type Resolver<T> = (args: { requestContext: unknown }) => Promise<T>;
const config = (tutorAgent as unknown as { config: Record<string, unknown> }).config;
const instructions = config.instructions as Resolver<string>;
const model = config.model as Resolver<unknown>;

// A fresh per-request context object (the real one is a RequestContext; the agent
// only calls get(), and uses the OBJECT IDENTITY as the WeakMap build-cache key).
function requestContext(values: Record<string, unknown>) {
  const m = new Map(Object.entries(values));
  return { get: (key: string) => m.get(key) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  loadAndBuildTutorPrompt.mockResolvedValue({
    ok: true,
    prompt: "YAML PROMPT",
    model: "yaml-model",
    provider: "SCCH",
  });
  resolveLanguageModel.mockReturnValue("resolved-model");
});

describe("tutorAgent per-request resolution", () => {
  it("resolves prompt + model from the YAML when the code has no override", async () => {
    const ctx = requestContext({ [TUTOR_URL]: "https://example.com/t.yaml" });
    await expect(instructions({ requestContext: ctx })).resolves.toBe("YAML PROMPT");
    await model({ requestContext: ctx });
    expect(resolveLanguageModel).toHaveBeenCalledWith("SCCH", "yaml-model");
    // Both resolvers share ONE request-scoped build.
    expect(loadAndBuildTutorPrompt).toHaveBeenCalledTimes(1);
  });

  it("applies the code's LLM override pair over the YAML's llm values", async () => {
    const ctx = requestContext({
      [TUTOR_URL]: "https://example.com/t.yaml",
      [TUTOR_PROVIDER_OVERRIDE]: "SCCH",
      [TUTOR_MODEL_OVERRIDE]: "override-model",
    });
    // The prompt is untouched — the override swaps only the LLM.
    await expect(instructions({ requestContext: ctx })).resolves.toBe("YAML PROMPT");
    await model({ requestContext: ctx });
    expect(resolveLanguageModel).toHaveBeenCalledWith("SCCH", "override-model");
  });

  it("gates availability on the EFFECTIVE provider (a Foundry override on an SCCH-only server fails)", async () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    const ctx = requestContext({
      [TUTOR_URL]: "https://example.com/t.yaml",
      [TUTOR_PROVIDER_OVERRIDE]: "Azure Foundry",
      [TUTOR_MODEL_OVERRIDE]: "gpt-5.4-mini",
    });
    await expect(model({ requestContext: ctx })).rejects.toThrow(/Azure Foundry/);
    expect(resolveLanguageModel).not.toHaveBeenCalled();
  });

  it("fails loud on a half/invalid override pair instead of silently picking a provider", async () => {
    const ctx = requestContext({
      [TUTOR_URL]: "https://example.com/t.yaml",
      [TUTOR_PROVIDER_OVERRIDE]: "OpenAI",
      [TUTOR_MODEL_OVERRIDE]: "gpt-4o",
    });
    await expect(model({ requestContext: ctx })).rejects.toThrow(/override is invalid/);
  });
});
