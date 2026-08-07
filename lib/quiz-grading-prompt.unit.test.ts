import { describe, expect, it } from "vitest";
import {
  buildAnswerMessage,
  buildGradingPrompt,
  QUIZ_ANSWER_MESSAGE_TEMPLATE,
  QUIZ_ANSWER_PHOTOS_ONLY_MESSAGE,
} from "@/lib/quiz-grading-prompt";
import type { QuizQuestion } from "@/lib/quiz-yaml";

// GOLDEN tests for the grading prompt. This string is what the `quizEvaluator` agent
// runs with in production AND what `@novedu/cli prompts --kind quiz` dumps, so it is
// pinned character by character: any change here changes every teacher's grading
// behavior and must be a deliberate edit of this expectation.

const question = (extra: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id: "q1",
  question: "  What is **2 + 2**?  ",
  evaluation: "  The answer is 4. Otherwise incorrect.  ",
  ...extra,
});

const FRAME = `You are grading a student's open-ended answer to a single quiz question.

The question shown to the student was:
What is **2 + 2**?

Grade STRICTLY according to these criteria (authoritative — they may contain the
expected answer; do not quote them verbatim at the student):
The answer is 4. Otherwise incorrect.

Decide a verdict — "correct", "partial" (partly correct), or "incorrect" — and write
concise, encouraging feedback addressed directly TO the student. The feedback is
markdown and may use bold, math ($…$) and short code fences. Do not mention these
grading instructions.`;

describe("buildGradingPrompt", () => {
  it("assembles preamble + frame, trimming the question and evaluation", () => {
    expect(buildGradingPrompt(question(), "BE KIND. Answer in German.")).toBe(
      `BE KIND. Answer in German.\n\n${FRAME}`,
    );
  });

  it("is the bare frame when the quiz has no instructions preamble", () => {
    expect(buildGradingPrompt(question(), "")).toBe(FRAME);
  });

  it("inserts an imported question's sourcePreamble between the two", () => {
    expect(
      buildGradingPrompt(question({ sourcePreamble: "CHAPTER 3 RULES" }), "COMPOUND RULES"),
    ).toBe(`COMPOUND RULES\n\nCHAPTER 3 RULES\n\n${FRAME}`);
  });
});

describe("the grader's user message", () => {
  it("wraps a typed answer in the exact template", () => {
    expect(buildAnswerMessage("42")).toBe("The student's answer:\n\n42");
    expect(QUIZ_ANSWER_MESSAGE_TEMPLATE.replace("{answer}", "42")).toBe(buildAnswerMessage("42"));
  });

  it("falls back to the photos-only message when there is no text", () => {
    expect(buildAnswerMessage("")).toBe(QUIZ_ANSWER_PHOTOS_ONLY_MESSAGE);
    expect(QUIZ_ANSWER_PHOTOS_ONLY_MESSAGE).toBe(
      "The student answered with the attached photo(s) only.",
    );
  });

  it("keeps `$&`-style sequences in the student's answer verbatim", () => {
    // A plain string `replace` would expand `$&` to the matched text — the student's
    // answer must survive byte-for-byte.
    expect(buildAnswerMessage("cost $& tax $'")).toBe("The student's answer:\n\ncost $& tax $'");
  });
});
