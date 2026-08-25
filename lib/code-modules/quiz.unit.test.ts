import { beforeEach, describe, expect, it, vi } from "vitest";

// The quiz code-module (Layer 3): buildRequestContext loads the quiz YAML to set the
// discussion system prompt + model (502 on load failure), and renderDetail dispatches
// to the shared conversation stats. Create-time validation (derived from fileKind by
// the registry) and the share-link result (the registry default) are not the
// descriptor's concern. loadQuiz is mocked; RequestContext is stubbed with a Map so the
// keys can be read back without coupling to @mastra/core internals.

const loadQuiz = vi.hoisted(() => vi.fn());
const conversationStats = vi.hoisted(() => vi.fn());

vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz }));
// renderDetail calls the shared ConversationStats; mock it (the real one pulls in
// the code-stats store → @/app/mastra, which this hermetic test must not load).
vi.mock("@/app/codes/[code]/conversation-stats", () => ({ ConversationStats: conversationStats }));
vi.mock("@/app/mastra/quiz-agents", () => ({
  QUIZ_DISCUSSION_INSTRUCTIONS: "quiz-discussion-instructions",
  QUIZ_DISCUSSION_MODEL: "quiz-discussion-model",
  QUIZ_DISCUSSION_PROVIDER: "quiz-discussion-provider",
  QUIZ_DISCUSSION_REASONING: "quiz-discussion-reasoning",
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

import { quizModule } from "@/lib/code-modules/quiz";
import type { CodeEntry } from "@/lib/code-store";

const entry = {
  code: "a1b2c3d4e5",
  module: "quiz",
  fileUrl: "https://example.com/api/files/q",
} as unknown as CodeEntry;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("quizModule.runtime.buildRequestContext", () => {
  it("502s when the quiz YAML cannot be loaded", async () => {
    loadQuiz.mockResolvedValue({ ok: false, message: "quiz unavailable" });
    expect(await quizModule.runtime?.buildRequestContext(entry)).toEqual({
      ok: false,
      status: 502,
      message: "quiz unavailable",
    });
  });

  it("sets the discussion model, provider and instructions (default frame + the quiz's own)", async () => {
    // A Foundry quiz needs the endpoint configured — the availability gate is real here.
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "https://res.openai.azure.com");
    loadQuiz.mockResolvedValue({
      ok: true,
      quiz: {
        model: "gemma-4",
        provider: "Azure Foundry",
        discussionInstructions: "Focus on big-O.",
        questions: [],
      },
    });
    const result = await quizModule.runtime?.buildRequestContext(entry);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("quiz-discussion-model")).toBe("gemma-4");
      expect(ctx.get("quiz-discussion-provider")).toBe("Azure Foundry");
      expect(ctx.get("quiz-discussion-reasoning")).toBeUndefined();
      const instr = ctx.get("quiz-discussion-instructions") as string;
      expect(instr).toContain("single quiz question"); // the default frame
      expect(instr).toContain("Focus on big-O."); // appended quiz-authored instructions
    }
  });

  it("502s a Foundry quiz when the server has no AZURE_FOUNDRY_ENDPOINT (availability gate)", async () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    try {
      loadQuiz.mockResolvedValue({
        ok: true,
        quiz: { model: "gpt-5.4-mini", provider: "Azure Foundry", questions: [] },
      });
      const result = await quizModule.runtime?.buildRequestContext(entry);
      expect(result).toMatchObject({
        ok: false,
        status: 502,
        message: expect.stringContaining("Azure Foundry"),
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("applies the code's LLM override pair over the quiz YAML's llm values", async () => {
    loadQuiz.mockResolvedValue({
      ok: true,
      quiz: {
        model: "yaml-model",
        provider: "SCCH",
        discussionInstructions: "Focus on big-O.",
        questions: [],
      },
    });
    const withOverride = {
      ...entry,
      llm: { provider: "SCCH", model: "override-model" },
    } as CodeEntry;
    const result = await quizModule.runtime?.buildRequestContext(withOverride);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("quiz-discussion-model")).toBe("override-model");
      expect(ctx.get("quiz-discussion-provider")).toBe("SCCH");
      // The override carries no level, so none is set (wholesale replacement).
      expect(ctx.get("quiz-discussion-reasoning")).toBeUndefined();
      // The instructions still come from the YAML — the override swaps only the LLM.
      expect(ctx.get("quiz-discussion-instructions")).toContain("Focus on big-O.");
    }
  });

  it("sets the discussion reasoning level from the EFFECTIVE llm", async () => {
    loadQuiz.mockResolvedValue({
      ok: true,
      quiz: { model: "yaml-model", provider: "SCCH", reasoning: "minimal", questions: [] },
    });
    // The YAML's level with no override…
    const fromYaml = await quizModule.runtime?.buildRequestContext(entry);
    if (fromYaml?.ok) {
      const ctx = fromYaml.context as unknown as { get(k: string): unknown };
      expect(ctx.get("quiz-discussion-reasoning")).toBe("minimal");
    }
    // …and the override's level when the code carries one.
    const withOverride = {
      ...entry,
      llm: { provider: "SCCH", model: "override-model", reasoning: "high" },
    } as CodeEntry;
    const overridden = await quizModule.runtime?.buildRequestContext(withOverride);
    if (overridden?.ok) {
      const ctx = overridden.context as unknown as { get(k: string): unknown };
      expect(ctx.get("quiz-discussion-reasoning")).toBe("high");
    }
  });

  it("502s a Foundry OVERRIDE on a server without AZURE_FOUNDRY_ENDPOINT (gate on the effective provider)", async () => {
    vi.stubEnv("AZURE_FOUNDRY_ENDPOINT", "");
    try {
      loadQuiz.mockResolvedValue({
        ok: true,
        quiz: { model: "gemma-4", provider: "SCCH", questions: [] },
      });
      const withOverride = {
        ...entry,
        llm: { provider: "Azure Foundry", model: "gpt-5.4-mini" },
      } as CodeEntry;
      const result = await quizModule.runtime?.buildRequestContext(withOverride);
      expect(result).toMatchObject({
        ok: false,
        status: 502,
        message: expect.stringContaining("Azure Foundry"),
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses only the default frame when the quiz omits discussionInstructions", async () => {
    loadQuiz.mockResolvedValue({ ok: true, quiz: { model: "gemma-4", questions: [] } });
    const result = await quizModule.runtime?.buildRequestContext(entry);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("quiz-discussion-instructions")).toContain("single quiz question");
    }
  });
});

describe("quizModule discussion instructions — compound quizzes", () => {
  it("uses ONLY the compound file's instructions — chapter sourcePreambles are grading-only", async () => {
    loadQuiz.mockResolvedValue({
      ok: true,
      quiz: {
        model: "gemma-4",
        provider: "SCCH",
        instructionsPreamble: "COMPOUND-PREAMBLE shared rules.",
        discussionInstructions: "COMPOUND-DISCUSSION guidance.",
        questions: [
          { id: "own", question: "Q", evaluation: "E" },
          { id: "intro/q1", question: "Q", evaluation: "E", sourcePreamble: "INTRO-PREAMBLE." },
          { id: "loops/q1", question: "Q", evaluation: "E", sourcePreamble: "LOOPS-PREAMBLE." },
        ],
      },
    });
    const result = await quizModule.runtime?.buildRequestContext(entry);
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    const ctx = result.context as unknown as { get(k: string): unknown };
    const instr = ctx.get("quiz-discussion-instructions") as string;
    // Compound preamble → the default frame → the compound's discussion guidance.
    const compoundAt = instr.indexOf("COMPOUND-PREAMBLE");
    const frameAt = instr.indexOf("single quiz question");
    const discussionAt = instr.indexOf("COMPOUND-DISCUSSION");
    expect(compoundAt).toBeGreaterThanOrEqual(0);
    expect(compoundAt).toBeLessThan(frameAt);
    expect(frameAt).toBeLessThan(discussionAt);
    // The chapters' preambles must NOT leak into the discussion prompt.
    expect(instr).not.toContain("INTRO-PREAMBLE");
    expect(instr).not.toContain("LOOPS-PREAMBLE");
  });
});

describe("quizModule.renderDetail", () => {
  it("renders the shared conversation stats", () => {
    conversationStats.mockReturnValue("<stats/>");
    const out = quizModule.renderDetail(entry, {});
    expect(conversationStats).toHaveBeenCalledWith({ entry });
    expect(out).toBe("<stats/>");
  });
});
