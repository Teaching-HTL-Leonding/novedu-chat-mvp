import { beforeEach, describe, expect, it, vi } from "vitest";

// The quiz code-module (Layer 3): validateOnCreate delegates to the quiz Layer-2
// validator, and buildRequestContext loads the quiz YAML to set the discussion
// system prompt + model (502 on load failure). loadQuiz + the validator are
// mocked; RequestContext is stubbed with a Map so the keys can be read back
// without coupling to @mastra/core internals.

const loadQuiz = vi.hoisted(() => vi.fn());
const quizValidate = vi.hoisted(() => vi.fn());
const conversationStats = vi.hoisted(() => vi.fn());

vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz }));
vi.mock("@/lib/file-validators", () => ({
  fileValidators: { quiz: { validate: quizValidate } },
}));
// renderDetail calls the shared ConversationStats; mock it (the real one pulls in
// the code-stats store → @/app/mastra, which this hermetic test must not load).
vi.mock("@/app/codes/[code]/conversation-stats", () => ({ ConversationStats: conversationStats }));
vi.mock("@/app/mastra/quiz-agents", () => ({
  QUIZ_DISCUSSION_INSTRUCTIONS: "quiz-discussion-instructions",
  QUIZ_DISCUSSION_MODEL: "quiz-discussion-model",
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
});

describe("quizModule.validateOnCreate", () => {
  it("delegates to the quiz Layer-2 validator", async () => {
    quizValidate.mockResolvedValue({
      ok: true,
      warnings: [],
      title: null,
      description: null,
      anonymous: true,
    });
    const fetcher = vi.fn();
    await quizModule.validateOnCreate(entry.fileUrl, fetcher);
    expect(quizValidate).toHaveBeenCalledWith(entry.fileUrl, fetcher);
  });
});

describe("quizModule.runtime.buildRequestContext", () => {
  it("502s when the quiz YAML cannot be loaded", async () => {
    loadQuiz.mockResolvedValue({ ok: false, message: "quiz unavailable" });
    expect(await quizModule.runtime.buildRequestContext(entry)).toEqual({
      ok: false,
      status: 502,
      message: "quiz unavailable",
    });
  });

  it("sets the discussion model and instructions (default frame + the quiz's own)", async () => {
    loadQuiz.mockResolvedValue({
      ok: true,
      quiz: { model: "gemma-4", discussionInstructions: "Focus on big-O." },
    });
    const result = await quizModule.runtime.buildRequestContext(entry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("quiz-discussion-model")).toBe("gemma-4");
      const instr = ctx.get("quiz-discussion-instructions") as string;
      expect(instr).toContain("single quiz question"); // the default frame
      expect(instr).toContain("Focus on big-O."); // appended quiz-authored instructions
    }
  });

  it("uses only the default frame when the quiz omits discussionInstructions", async () => {
    loadQuiz.mockResolvedValue({ ok: true, quiz: { model: "gemma-4" } });
    const result = await quizModule.runtime.buildRequestContext(entry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = result.context as unknown as { get(k: string): unknown };
      expect(ctx.get("quiz-discussion-instructions")).toContain("single quiz question");
    }
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
