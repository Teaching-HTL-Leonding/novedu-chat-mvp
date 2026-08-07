import { describe, expect, it } from "vitest";
import {
  buildDiscussionInstructions,
  buildQuestionSeed,
  buildVerdictSeed,
} from "@/lib/quiz-discussion-prompt";
import type { Quiz } from "@/lib/quiz-yaml";

// GOLDEN tests for the discussion prompt + the thread's seed messages: what the
// `quizDiscussion` agent runs with in production and what `prompts --kind quiz` dumps.

const BASE =
  "You are helping a student understand a single quiz question. The conversation " +
  "already contains the question, the student's submitted answer, and the verdict " +
  "with feedback — use that context. Be concise and encouraging, and stay on this " +
  "question.";

const quiz = (extra: Partial<Quiz> = {}): Quiz =>
  ({
    id: "q",
    anonymous: true,
    shuffle: true,
    model: "m",
    provider: "SCCH",
    imageInput: false,
    fragmentBlock: { fragment_files: [], text_files: [] },
    quizFiles: [],
    instructionsPreamble: "",
    questions: [],
    ...extra,
  }) as Quiz;

describe("buildDiscussionInstructions", () => {
  it("is the bare frame for a quiz with neither preamble nor guidance", () => {
    expect(buildDiscussionInstructions(quiz())).toBe(BASE);
  });

  it("prepends the quiz's rendered instructions preamble", () => {
    expect(buildDiscussionInstructions(quiz({ instructionsPreamble: "BE KIND." }))).toBe(
      `BE KIND.\n\n${BASE}`,
    );
  });

  it("appends the quiz's discussion guidance after the frame", () => {
    expect(
      buildDiscussionInstructions(
        quiz({ instructionsPreamble: "BE KIND.", discussionInstructions: "  Use analogies.  " }),
      ),
    ).toBe(`BE KIND.\n\n${BASE}\n\nUse analogies.`);
  });
});

describe("the discussion thread's seed messages", () => {
  it("renders the question seed", () => {
    expect(buildQuestionSeed("What is 2 + 2?")).toBe(
      "Answer the following question: What is 2 + 2?",
    );
  });

  it("renders the verdict seed with the student-facing label", () => {
    expect(buildVerdictSeed("partial", "Almost — check the units.")).toBe(
      "Your answer is partly correct. Almost — check the units.",
    );
    expect(buildVerdictSeed("incorrect", "")).toBe("Your answer is wrong.");
    expect(buildVerdictSeed("correct", "Well done.")).toBe("Your answer is correct. Well done.");
  });
});
