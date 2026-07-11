// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// The grading action's LLM selection and the photo-answer handling:
// `submitAnswer` re-verifies the code, re-loads the quiz, validates the images
// against the question's EFFECTIVE imageInput flag (both stay real), and runs
// the server-only `quizEvaluator` with the EFFECTIVE provider/model — the code's
// LLM override pair when set, the quiz YAML's llm values otherwise
// (`effectiveLlm` stays real). `startDiscussion` seeds the graded turn — photos
// as stored `file` parts — into a Mastra thread. The I/O seams are mocked: the
// session, the code gate, the quiz load, the Mastra agent + memory, and the
// usage counter.

const auth = vi.hoisted(() => vi.fn());
const checkCode = vi.hoisted(() => vi.fn());
const loadQuiz = vi.hoisted(() => vi.fn());
const generate = vi.hoisted(() => vi.fn());
const createThread = vi.hoisted(() => vi.fn());
const saveMessages = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/code-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/code-store")>()),
  checkCode,
}));
vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz }));
vi.mock("@/app/mastra", () => ({
  mastra: {
    getAgent: () => ({ generate, getMemory: async () => ({ createThread, saveMessages }) }),
  },
}));
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
import { startDiscussion, submitAnswer } from "@/lib/quiz-actions";

const entry = {
  code: "a1b2c3d4e5",
  module: "quiz",
  fileUrl: "https://example.com/api/files/q",
  llm: null,
};

const quiz = {
  model: "yaml-model",
  provider: "SCCH",
  imageInput: false,
  questions: [{ id: "q1", question: "What is 2+2?", evaluation: "4 is correct." }],
};

/** A well-formed image data URL whose decoded payload is `bytes` long. */
function dataUrlOfBytes(bytes: number): string {
  return `data:image/png;base64,${Buffer.alloc(bytes).toString("base64")}`;
}

const PHOTO = dataUrlOfBytes(16);

/** The mocked quiz with photo answers enabled at the given levels. */
function quizWithImageInput(quizLevel: boolean, questionLevel?: boolean) {
  return {
    ...quiz,
    imageInput: quizLevel,
    questions: [
      {
        ...quiz.questions[0],
        ...(questionLevel === undefined ? {} : { imageInput: questionLevel }),
      },
    ],
  };
}

// The evaluator's requestContext, captured from the generate() call.
function gradedContext(): { get(k: string): unknown } {
  const options = generate.mock.calls[0]?.[1] as { requestContext: { get(k: string): unknown } };
  return options.requestContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  // `startDiscussion` signs a real thread token (lib/thread-token stays real).
  process.env.AUTH_SECRET = "unit-test-secret";
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

describe("submitAnswer photo answers", () => {
  it("rejects an empty submission (no text, no images)", async () => {
    const result = await submitAnswer({ code: entry.code, questionId: "q1", answer: "  " });
    expect(result).toEqual({
      ok: false,
      message: "Type an answer or add a photo before submitting.",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects images when the question's effective imageInput is false", async () => {
    const result = await submitAnswer({
      code: entry.code,
      questionId: "q1",
      answer: "4",
      images: [PHOTO],
    });
    expect(result).toEqual({ ok: false, message: "Images are not accepted for this question." });
    expect(generate).not.toHaveBeenCalled();
  });

  it("honors a per-question override in both directions", async () => {
    // Quiz-level ON, question opts OUT.
    loadQuiz.mockResolvedValue({ ok: true, quiz: quizWithImageInput(true, false) });
    const optOut = await submitAnswer({
      code: entry.code,
      questionId: "q1",
      answer: "4",
      images: [PHOTO],
    });
    expect(optOut).toEqual({ ok: false, message: "Images are not accepted for this question." });

    // Quiz-level OFF, question opts IN.
    loadQuiz.mockResolvedValue({ ok: true, quiz: quizWithImageInput(false, true) });
    const optIn = await submitAnswer({
      code: entry.code,
      questionId: "q1",
      answer: "4",
      images: [PHOTO],
    });
    expect(optIn).toMatchObject({ ok: true });
  });

  it("rejects too many and oversized images server-side", async () => {
    loadQuiz.mockResolvedValue({ ok: true, quiz: quizWithImageInput(true) });
    const tooMany = await submitAnswer({
      code: entry.code,
      questionId: "q1",
      answer: "4",
      images: [PHOTO, PHOTO, PHOTO, PHOTO],
    });
    expect(tooMany).toEqual({ ok: false, message: "At most 3 photos per answer." });

    const tooBig = await submitAnswer({
      code: entry.code,
      questionId: "q1",
      answer: "4",
      images: [dataUrlOfBytes(5 * 1024 * 1024 + 1)],
    });
    expect(tooBig).toEqual({ ok: false, message: "Each photo must be 5 MB or smaller." });
    expect(generate).not.toHaveBeenCalled();
  });

  it("grades text + photos as ONE multimodal user message", async () => {
    loadQuiz.mockResolvedValue({ ok: true, quiz: quizWithImageInput(true) });
    const result = await submitAnswer({
      code: entry.code,
      questionId: "q1",
      answer: "4",
      images: [PHOTO, PHOTO],
    });
    expect(result).toMatchObject({ ok: true });
    expect(generate.mock.calls[0]?.[0]).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "The student's answer:\n\n4" },
          { type: "image", image: PHOTO },
          { type: "image", image: PHOTO },
        ],
      },
    ]);
  });

  it("accepts an image-only answer and says so in the text part", async () => {
    loadQuiz.mockResolvedValue({ ok: true, quiz: quizWithImageInput(true) });
    const result = await submitAnswer({
      code: entry.code,
      questionId: "q1",
      answer: "",
      images: [PHOTO],
    });
    expect(result).toMatchObject({ ok: true });
    const message = generate.mock.calls[0]?.[0] as Array<{ content: Array<{ text?: string }> }>;
    expect(message[0]?.content[0]?.text).toBe(
      "The student answered with the attached photo(s) only.",
    );
  });

  it("keeps the plain-string prompt for a text-only answer", async () => {
    const result = await submitAnswer({ code: entry.code, questionId: "q1", answer: "4" });
    expect(result).toMatchObject({ ok: true });
    expect(generate.mock.calls[0]?.[0]).toBe("The student's answer:\n\n4");
  });
});

describe("startDiscussion photo seeds", () => {
  it("rejects images when the question's effective imageInput is false", async () => {
    const result = await startDiscussion({
      code: entry.code,
      questionId: "q1",
      answer: "4",
      result: "correct",
      feedback: "Well done.",
      images: [PHOTO],
    });
    expect(result).toEqual({ ok: false, message: "Images are not accepted for this question." });
    expect(saveMessages).not.toHaveBeenCalled();
  });

  it("seeds the student-answer message with one stored `file` part per photo", async () => {
    loadQuiz.mockResolvedValue({ ok: true, quiz: quizWithImageInput(true) });
    const result = await startDiscussion({
      code: entry.code,
      questionId: "q1",
      answer: "4",
      result: "correct",
      feedback: "Well done.",
      images: [PHOTO],
    });
    expect(result).toMatchObject({ ok: true });
    const messages = saveMessages.mock.calls[0]?.[0]?.messages as Array<{
      role: string;
      content: { parts: unknown[]; content: string };
    }>;
    expect(messages).toHaveLength(3);
    expect(messages[1]?.role).toBe("user");
    // The v2 UIMessage shape the transcript viewer parses: text part + `file`
    // part whose `data` is the data URL (see lib/conversation-collapse.ts).
    expect(messages[1]?.content.parts).toEqual([
      { type: "text", text: "4" },
      { type: "file", mimeType: "image/png", data: PHOTO },
    ]);
    // The other seeds stay text-only.
    expect(messages[0]?.content.parts).toEqual([
      { type: "text", text: expect.stringContaining("What is 2+2?") },
    ]);
  });

  it("accepts an image-only graded turn and seeds no empty text part", async () => {
    loadQuiz.mockResolvedValue({ ok: true, quiz: quizWithImageInput(true) });
    const result = await startDiscussion({
      code: entry.code,
      questionId: "q1",
      answer: "",
      result: "correct",
      feedback: "Well done.",
      images: [PHOTO],
    });
    expect(result).toMatchObject({ ok: true });
    const messages = saveMessages.mock.calls[0]?.[0]?.messages as Array<{
      content: { parts: Array<{ type: string }> };
    }>;
    expect(messages[1]?.content.parts).toEqual([
      { type: "file", mimeType: "image/png", data: PHOTO },
    ]);
  });

  it("still rejects a discussion with neither text nor images", async () => {
    const result = await startDiscussion({
      code: entry.code,
      questionId: "q1",
      answer: "",
      result: "correct",
      feedback: "Well done.",
    });
    expect(result).toEqual({ ok: false, message: "There is no answer to discuss yet." });
  });
});
