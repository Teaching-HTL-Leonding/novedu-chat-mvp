import { assert, describe, expect, it, vi } from "vitest";

// The writing code-module (Layer 3): buildRequestContext loads the writing YAML and
// sets the agent instructions + model on the RequestContext (502 on load failure); and
// renderDetail dispatches to the savers list (attributed) or the shared
// ConversationStats (anonymous). Create-time validation (derived from fileKind by the
// registry) and the share-link result (the registry default) are not the descriptor's
// concern. loadWriting + both render components are mocked as plain functions.

const loadWriting = vi.hoisted(() => vi.fn());
const writingSaversList = vi.hoisted(() => vi.fn());
const conversationStats = vi.hoisted(() => vi.fn());

vi.mock("@/lib/writing-fetch", () => ({ loadWriting }));
vi.mock("@/app/[code]/_writing/writing-review", () => ({ WritingSaversList: writingSaversList }));
vi.mock("@/app/codes/[code]/conversation-stats", () => ({ ConversationStats: conversationStats }));
vi.mock("@/app/mastra/writing-agents", () => ({
  WRITING_INSTRUCTIONS: "writing-instructions",
  WRITING_MODEL: "writing-model",
  WRITING_PROVIDER: "writing-provider",
  WRITING_REASONING: "writing-reasoning",
}));

import { writingModule } from "@/lib/code-modules/writing";
import type { CodeEntry } from "@/lib/code-store";

const entry = {
  code: "a1b2c3d4e5",
  module: "writing",
  fileUrl: "https://example.com/api/files/w",
  anonymous: false,
} as unknown as CodeEntry;

describe("writingModule descriptor", () => {
  it("references the writing file kind", () => {
    expect(writingModule.fileKind).toBe("writing");
    expect(writingModule.runtime?.agentId).toBe("writing");
  });
});

describe("writingModule.runtime.buildRequestContext", () => {
  it("502s when the writing YAML cannot be loaded", async () => {
    loadWriting.mockResolvedValue({ ok: false, message: "writing unavailable" });
    expect(await writingModule.runtime?.buildRequestContext(entry)).toEqual({
      ok: false,
      status: 502,
      message: "writing unavailable",
    });
  });

  it("502s a Foundry activity when the server has no AZURE_FOUNDRY_ENDPOINT (availability gate)", async () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    loadWriting.mockResolvedValue({
      ok: true,
      writing: { model: "gpt-5.4-mini", provider: "Azure Foundry", instructions: "Coach." },
    });
    const result = await writingModule.runtime?.buildRequestContext(entry);
    expect(result).toMatchObject({
      ok: false,
      status: 502,
      message: expect.stringContaining("Azure Foundry"),
    });
  });

  it("sets the model, provider and the teacher's instructions on the request context", async () => {
    loadWriting.mockResolvedValue({
      ok: true,
      writing: { model: "gemma-4", provider: "SCCH", instructions: "Be a writing coach." },
    });
    const result = await writingModule.runtime?.buildRequestContext(entry);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("writing-model")).toBe("gemma-4");
      expect(ctx.get("writing-provider")).toBe("SCCH");
      expect(ctx.get("writing-instructions")).toBe("Be a writing coach.");
    }
  });

  it("applies the code's LLM override pair over the writing YAML's llm values", async () => {
    loadWriting.mockResolvedValue({
      ok: true,
      writing: { model: "yaml-model", provider: "SCCH", instructions: "Be a writing coach." },
    });
    const withOverride = {
      ...entry,
      llm: { provider: "SCCH", model: "override-model" },
    } as CodeEntry;
    const result = await writingModule.runtime?.buildRequestContext(withOverride);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("writing-model")).toBe("override-model");
      expect(ctx.get("writing-provider")).toBe("SCCH");
      // The override carries no level, so none is set (wholesale replacement).
      expect(ctx.get("writing-reasoning")).toBeUndefined();
      // The instructions still come from the YAML — the override swaps only the LLM.
      expect(ctx.get("writing-instructions")).toBe("Be a writing coach.");
    }
  });

  it("sets the reasoning level from the EFFECTIVE llm", async () => {
    loadWriting.mockResolvedValue({
      ok: true,
      writing: {
        model: "yaml-model",
        provider: "SCCH",
        reasoning: "minimal",
        instructions: "Be a writing coach.",
      },
    });
    // The YAML's level with no override…
    const fromYaml = await writingModule.runtime?.buildRequestContext(entry);
    assert(fromYaml?.ok);
    const yamlCtx = fromYaml.context as unknown as { get(k: string): unknown };
    expect(yamlCtx.get("writing-reasoning")).toBe("minimal");
    // …and the override's level when the code carries one.
    const withOverride = {
      ...entry,
      llm: { provider: "SCCH", model: "override-model", reasoning: "high" },
    } as CodeEntry;
    const overridden = await writingModule.runtime?.buildRequestContext(withOverride);
    assert(overridden?.ok);
    const overrideCtx = overridden.context as unknown as { get(k: string): unknown };
    expect(overrideCtx.get("writing-reasoning")).toBe("high");
  });

  it("502s a Foundry OVERRIDE on a server without AZURE_FOUNDRY_ENDPOINT (gate on the effective provider)", async () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    loadWriting.mockResolvedValue({
      ok: true,
      writing: { model: "gemma-4", provider: "SCCH", instructions: "Coach." },
    });
    const withOverride = {
      ...entry,
      llm: { provider: "Azure Foundry", model: "gpt-5.4-mini" },
    } as CodeEntry;
    const result = await writingModule.runtime?.buildRequestContext(withOverride);
    expect(result).toMatchObject({
      ok: false,
      status: 502,
      message: expect.stringContaining("Azure Foundry"),
    });
  });
});

describe("writingModule.renderDetail", () => {
  it("renders the savers list for an attributed code, passing the code + search", () => {
    writingSaversList.mockReturnValue("<savers/>");
    const out = writingModule.renderDetail(entry, { q: "ada" });
    expect(writingSaversList).toHaveBeenCalledWith({ code: entry.code, search: "ada" });
    expect(conversationStats).not.toHaveBeenCalled();
    expect(out).toBe("<savers/>");
  });

  it("ignores a non-string search param (no filter)", () => {
    writingSaversList.mockReturnValue("<savers/>");
    writingModule.renderDetail(entry, { q: ["a", "b"] });
    expect(writingSaversList).toHaveBeenCalledWith({ code: entry.code, search: undefined });
  });

  it("falls back to the conversation stats for an anonymous code", () => {
    conversationStats.mockReturnValue("<stats/>");
    const anon = { ...entry, anonymous: true } as unknown as CodeEntry;
    const out = writingModule.renderDetail(anon, {});
    expect(conversationStats).toHaveBeenCalledWith({ entry: anon });
    expect(writingSaversList).not.toHaveBeenCalled();
    expect(out).toBe("<stats/>");
  });
});
