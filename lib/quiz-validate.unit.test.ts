import { describe, expect, it } from "vitest";
import { parse as parseYamlText } from "yaml";
import { checkQuizValue, loadAndCheckQuiz } from "@/lib/quiz-validate";
import type { Fetcher } from "@/lib/tutors";

// The quiz AUTHORING validator: the strict schema gate + the duplicate-question-id
// pass. Pure, no network — a fixture Fetcher returns YAML text in-process.

const URL_ = "https://example.com/quiz.yaml";
const fetcherFor =
  (text: string, ok = true): Fetcher =>
  async () => ({ ok, status: ok ? 200 : 404, text: async () => text });

const VALID = `
id: capitals
name: "Capitals"
title: "Capitals Quiz"
anonymous: false
shuffle: false
llm:
  model: some-model
discussion:
  instructions: "Be kind."
questions:
  - id: a
    title: "A"
    question: "What is the capital of France?"
    evaluation: "Paris. correct|incorrect."
    image:
      hosted: true
      src: a-map
      alt: A map.
  - id: b
    question: "What is the capital of Italy?"
    evaluation: "Rome. correct|incorrect."
`;

describe("loadAndCheckQuiz — positive", () => {
  it("accepts a valid quiz and reports its metadata", async () => {
    const result = await loadAndCheckQuiz(URL_, fetcherFor(VALID));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quizId).toBe("capitals");
      expect(result.model).toBe("some-model");
      expect(result.questionCount).toBe(2);
      expect(result.anonymous).toBe(false);
      expect(result.title).toBe("Capitals Quiz");
    }
  });

  it("defaults anonymous to TRUE and title to null when omitted", async () => {
    const minimal = `
id: q
llm:
  model: m
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
`;
    const result = await loadAndCheckQuiz(URL_, fetcherFor(minimal));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.anonymous).toBe(true);
      expect(result.title).toBeNull();
    }
  });
});

describe("loadAndCheckQuiz — negative", () => {
  it("rejects a fetch failure as FETCH_FAILED (no throw)", async () => {
    const result = await loadAndCheckQuiz(URL_, fetcherFor("", false));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("FETCH_FAILED");
  });

  it("rejects invalid YAML as YAML_PARSE_ERROR", async () => {
    const result = await loadAndCheckQuiz(URL_, fetcherFor("id: q\n  bad: : :"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("YAML_PARSE_ERROR");
  });

  it("rejects a disallowed URL scheme as INVALID_URL", async () => {
    const result = await loadAndCheckQuiz("file:///etc/passwd", fetcherFor(VALID));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("INVALID_URL");
  });
});

describe("checkQuizValue — schema errors", () => {
  const check = (yaml: string) => checkQuizValue(parseYamlText(yaml), URL_);

  it("rejects a missing llm.model", () => {
    const result = check(`
id: q
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("QUIZ_SCHEMA_ERROR");
  });

  it("rejects a quiz with no questions", () => {
    const result = check(`
id: q
llm:
  model: m
questions: []
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("QUIZ_SCHEMA_ERROR");
  });

  it("rejects a question missing its evaluation", () => {
    const result = check(`
id: q
llm:
  model: m
questions:
  - id: a
    question: "Q?"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("QUIZ_SCHEMA_ERROR");
  });

  it("rejects an unrecognized (misspelled) key", () => {
    const result = check(`
id: q
naem: typo
llm:
  model: m
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("QUIZ_SCHEMA_ERROR");
      expect(result.errors[0]?.zodIssues).toBeTruthy();
    }
  });
});

describe("checkQuizValue — duplicate question ids", () => {
  it("rejects a duplicate question id with DUPLICATE_QUIZ_QUESTION_ID", () => {
    const result = checkQuizValue(
      parseYamlText(`
id: q
llm:
  model: m
questions:
  - id: dup
    question: "Q1?"
    evaluation: "grade"
  - id: dup
    question: "Q2?"
    evaluation: "grade"
`),
      URL_,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("DUPLICATE_QUIZ_QUESTION_ID");
      expect(result.errors[0]?.questionId).toBe("dup");
    }
  });
});
