import { describe, expect, it, vi } from "vitest";

// The tutor code-module (Layer 3): buildRequestContext only carries the tutor URL
// (the agent loads/builds the prompt itself per request) plus, when the code has
// one, the LLM override pair the agent applies over the YAML's llm values.
// renderDetail dispatches to the shared conversation stats. The agent module is
// mocked (it pulls in @mastra Agent/Memory) — only its context-key constants are
// needed here; RequestContext is stubbed with a Map so the keys read back without
// coupling to @mastra/core.

const conversationStats = vi.hoisted(() => vi.fn());

vi.mock("@/app/codes/[code]/conversation-stats", () => ({ ConversationStats: conversationStats }));
vi.mock("@/app/mastra/tutor-agent", () => ({
  TUTOR_URL: "tutor-url",
  TUTOR_PROVIDER_OVERRIDE: "tutor-provider-override",
  TUTOR_MODEL_OVERRIDE: "tutor-model-override",
}));
vi.mock("@mastra/core/request-context", () => ({
  RequestContext: class {
    private m = new Map<string, unknown>();
    set(key: string, value: unknown) {
      this.m.set(key, value);
    }
    get(key: string) {
      return this.m.get(key);
    }
  },
}));

import { tutorModule } from "@/lib/code-modules/tutor";
import type { CodeEntry } from "@/lib/code-store";

const entry = {
  code: "a1b2c3d4e5",
  module: "tutor",
  fileUrl: "https://example.com/tutor.yaml",
  llm: null,
} as unknown as CodeEntry;

describe("tutorModule.runtime.buildRequestContext", () => {
  it("carries the tutor URL and no override keys for a code without one", async () => {
    const result = await tutorModule.runtime?.buildRequestContext(entry);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("tutor-url")).toBe(entry.fileUrl);
      expect(ctx.get("tutor-provider-override")).toBeUndefined();
      expect(ctx.get("tutor-model-override")).toBeUndefined();
    }
  });

  it("carries the code's LLM override pair for the agent to apply", async () => {
    const withOverride = {
      ...entry,
      llm: { provider: "Azure Foundry", model: "gpt-5.4-mini" },
    } as CodeEntry;
    const result = await tutorModule.runtime?.buildRequestContext(withOverride);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("tutor-url")).toBe(entry.fileUrl);
      expect(ctx.get("tutor-provider-override")).toBe("Azure Foundry");
      expect(ctx.get("tutor-model-override")).toBe("gpt-5.4-mini");
    }
  });
});

describe("tutorModule.renderDetail", () => {
  it("renders the shared conversation stats", () => {
    conversationStats.mockReturnValue("<stats/>");
    const out = tutorModule.renderDetail(entry, {});
    expect(conversationStats).toHaveBeenCalledWith({ entry });
    expect(out).toBe("<stats/>");
  });
});

describe("tutorModule result", () => {
  it("uses the registry default (no renderResult override)", () => {
    expect(tutorModule.renderResult).toBeUndefined();
  });
});
