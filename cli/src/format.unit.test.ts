// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { QuizCheckResult } from "@/lib/quiz-validate";
import type { BuildResult, FragmentCheckResult } from "@/lib/tutors";
import type { WritingCheckResult } from "@/lib/writing-validate";
import {
  formatFragmentResult,
  formatQuizResult,
  formatResult,
  formatWritingResult,
} from "./format";

// The formatter is pure presentation; these tests pin that a schema error's Zod
// field detail makes it into the human-readable report (not just the generic
// message), so the CLI is as diagnosable as the web UI.

describe("formatResult — schema error detail", () => {
  it("flattens zod issues beneath the tutor error line", () => {
    const result: BuildResult = {
      ok: false,
      warnings: [],
      errors: [
        {
          code: "TUTOR_SCHEMA_ERROR",
          message: "Document does not match the expected structure",
          zodIssues: {
            errors: ['Unrecognized key: "nae"'],
            properties: {
              name: { errors: ["Invalid input: expected string, received undefined"] },
            },
          },
        },
      ],
    };

    const out = formatResult(result, "tutor.yaml");

    expect(out).toContain("TUTOR_SCHEMA_ERROR");
    expect(out).toContain('Unrecognized key: "nae"');
    expect(out).toContain("name: Invalid input: expected string, received undefined");
  });
});

describe("formatFragmentResult — schema error detail", () => {
  it("flattens zod issues beneath the fragment error line", () => {
    const result: FragmentCheckResult = {
      ok: false,
      warnings: [],
      errors: [
        {
          code: "FRAGMENT_FILE_SCHEMA_ERROR",
          message: "Document does not match the expected structure",
          zodIssues: { properties: { id: { errors: ["Invalid input: expected string"] } } },
        },
      ],
    };

    const out = formatFragmentResult(result, "fragments.yaml");

    expect(out).toContain("FRAGMENT_FILE_SCHEMA_ERROR");
    expect(out).toContain("id: Invalid input: expected string");
  });
});

describe("formatQuizResult", () => {
  it("renders a valid quiz's id, model and question count", () => {
    const result: QuizCheckResult = {
      ok: true,
      quizId: "capitals",
      model: "some-model",
      provider: "SCCH",
      questionCount: 5,
      anonymous: false,
      title: "Capitals",
      warnings: [],
    };

    const out = formatQuizResult(result, "quiz.yaml");

    expect(out).toContain("Valid quiz");
    expect(out).toContain("capitals");
    expect(out).toContain("questions: 5");
  });

  it("flattens zod issues beneath the quiz schema error line", () => {
    const result: QuizCheckResult = {
      ok: false,
      warnings: [],
      errors: [
        {
          code: "QUIZ_SCHEMA_ERROR",
          message: "Document does not match the expected structure",
          zodIssues: { properties: { llm: { errors: ["Invalid input: expected object"] } } },
        },
      ],
    };

    const out = formatQuizResult(result, "quiz.yaml");

    expect(out).toContain("QUIZ_SCHEMA_ERROR");
    expect(out).toContain("llm: Invalid input: expected object");
  });

  it("labels a duplicate-question-id error with the question id", () => {
    const result: QuizCheckResult = {
      ok: false,
      warnings: [],
      errors: [
        { code: "DUPLICATE_QUIZ_QUESTION_ID", message: 'Question id "a" …', questionId: "a" },
      ],
    };

    const out = formatQuizResult(result, "quiz.yaml");

    expect(out).toContain("DUPLICATE_QUIZ_QUESTION_ID");
    expect(out).toContain("question=a");
  });
});

describe("formatWritingResult", () => {
  it("renders a valid writing activity's id and model", () => {
    const result: WritingCheckResult = {
      ok: true,
      writingId: "essay",
      model: "some-model",
      provider: "SCCH",
      anonymous: false,
      title: "Essay",
      warnings: [],
    };

    const out = formatWritingResult(result, "writing.yaml");

    expect(out).toContain("Valid writing activity");
    expect(out).toContain("essay");
  });

  it("flattens zod issues beneath the writing schema error line", () => {
    const result: WritingCheckResult = {
      ok: false,
      warnings: [],
      errors: [
        {
          code: "WRITING_SCHEMA_ERROR",
          message: "Document does not match the expected structure",
          zodIssues: {
            properties: { instructions: { errors: ["Invalid input: expected string"] } },
          },
        },
      ],
    };

    const out = formatWritingResult(result, "writing.yaml");

    expect(out).toContain("WRITING_SCHEMA_ERROR");
    expect(out).toContain("instructions: Invalid input: expected string");
  });
});
