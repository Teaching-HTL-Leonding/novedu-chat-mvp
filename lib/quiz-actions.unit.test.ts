// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// The grading action's LLM selection: `submitAnswer` re-verifies the code,
// re-loads the quiz, and runs the server-only `quizEvaluator` with the EFFECTIVE
// provider/model — the code's LLM override pair when set, the quiz YAML's llm
// values otherwise (`effectiveLlm` stays real). The I/O seams are mocked: the
// session, the code gate, the quiz load, the Mastra agent, and the usage counter.

const auth = vi.hoisted(() => vi.fn());
const checkCode = vi.hoisted(() => vi.fn());
const loadQuiz = vi.hoisted(() => vi.fn());
const generate = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/code-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/code-store")>()),
  checkCode,
}));
vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz }));
vi.mock("@/app/mastra", () => ({ mastra: { getAgent: () => ({ generate }) } }));
vi.mock("@/lib/usage-store", () => ({ recordQuizAnswer: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
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

import { QUIZ_EVAL_MODEL, QUIZ_EVAL_PROVIDER } from "@/app/mastra/quiz-agents";
import { submitAnswer } from "@/lib/quiz-actions";

const entry = {
  code: "a1b2c3d4e5",
  module: "quiz",
  fileUrl: "https://example.com/api/files/q",
  llm: null,
};

const quiz = {
  model: "yaml-model",
  provider: "SCCH",
  questions: [{ id: "q1", question: "What is 2+2?", evaluation: "4 is correct." }],
};

// The evaluator's requestContext, captured from the generate() call.
function gradedContext(): { get(k: string): unknown } {
  const options = generate.mock.calls[0]?.[1] as { requestContext: { get(k: string): unknown } };
  return options.requestContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "student-1" } });
  checkCode.mockResolvedValue({ ok: true, entry });
  loadQuiz.mockResolvedValue({ ok: true, quiz });
  generate.mockResolvedValue({ object: { result: "correct", feedback: "Well done." } });
});

describe("submitAnswer LLM selection", () => {
  it("grades with the quiz YAML's provider/model when the code has no override", async () => {
    const result = await submitAnswer({ code: entry.code, questionId: "q1", answer: "4" });
    expect(result).toEqual({ ok: true, result: "correct", feedback: "Well done." });
    expect(gradedContext().get(QUIZ_EVAL_MODEL)).toBe("yaml-model");
    expect(gradedContext().get(QUIZ_EVAL_PROVIDER)).toBe("SCCH");
  });

  it("grades with the code's LLM override pair when set", async () => {
    checkCode.mockResolvedValue({
      ok: true,
      entry: { ...entry, llm: { provider: "Azure Foundry", model: "gpt-5.4-mini" } },
    });
    const result = await submitAnswer({ code: entry.code, questionId: "q1", answer: "4" });
    expect(result).toMatchObject({ ok: true });
    expect(gradedContext().get(QUIZ_EVAL_MODEL)).toBe("gpt-5.4-mini");
    expect(gradedContext().get(QUIZ_EVAL_PROVIDER)).toBe("Azure Foundry");
  });
});
