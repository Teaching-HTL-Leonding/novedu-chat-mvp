import { describe, expect, it } from "vitest";
import { parse as parseYamlText } from "yaml";
import type { Fetcher } from "@/lib/prompt-fragments";
import { checkQuizValue, loadAndCheckQuiz } from "@/lib/quiz-validate";

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
      expect(result.provider).toBe("SCCH"); // llm.provider defaults to SCCH
      expect(result.questionCount).toBe(2);
      expect(result.anonymous).toBe(false);
      expect(result.title).toBe("Capitals Quiz");
    }
  });

  it("accepts and reports an explicit llm.provider", async () => {
    const foundry = `
id: q
llm:
  model: gpt-5.4-mini
  provider: Azure Foundry
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
`;
    const result = await loadAndCheckQuiz(URL_, fetcherFor(foundry));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provider).toBe("Azure Foundry");
  });

  it("accepts the two-level imageInput flags (llm-level default + per-question override)", async () => {
    const withImages = `
id: q
llm:
  model: m
  imageInput: true
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
    imageInput: false
`;
    const result = await loadAndCheckQuiz(URL_, fetcherFor(withImages));
    expect(result.ok).toBe(true);
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

  it("rejects an unsupported llm.provider", () => {
    const result = check(`
id: q
llm:
  model: m
  provider: OpenAI
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
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

  it("rejects a non-boolean imageInput", () => {
    const result = check(`
id: q
llm:
  model: m
  imageInput: "yes"
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
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

// --- document-level prompt fragments (the authoring gate for quiz fragments) -------

const LIB_URL = "https://example.com/lib.yaml";
const LIB_YAML = `id: lib
fragments:
  - id: safety
    version: 1
    content: |
      Always be safe and kind.
  - id: lang
    version: 1
    input_schema:
      type: object
      required: [language]
      properties:
        language:
          type: string
    content: |
      Respond in {{language}}.
`;

// A fetcher serving distinct bodies per URL (quiz + its fragment library).
const fetcherMap =
  (bodies: Record<string, string>): Fetcher =>
  async (url) => {
    const text = bodies[url];
    return text === undefined
      ? { ok: false, status: 404, text: async () => "" }
      : { ok: true, status: 200, text: async () => text };
  };

// The quiz declares its fragment library via `fragment_files:` and expresses WHICH
// fragments it uses with inline `{{fragment}}` markers in the `instructions` host text.
const quizWithFragments = (instructions: string) => `
id: q
llm:
  model: m
fragment_files:
  - id: lib
    url: ${LIB_URL}
instructions: |
${instructions}
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
`;

describe("loadAndCheckQuiz — fragments", () => {
  it("accepts a quiz that pulls in valid fragments", async () => {
    const quiz = quizWithFragments(
      '  {{fragment "lib.safety"}}\n  {{fragment "lib.lang" language="German"}}',
    );
    const result = await loadAndCheckQuiz(URL_, fetcherMap({ [URL_]: quiz, [LIB_URL]: LIB_YAML }));
    expect(result.ok).toBe(true);
  });

  it("a plain quiz (no fragments) is still valid and does no fetch", async () => {
    const plain = `
id: q
llm:
  model: m
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
`;
    // Fetcher that throws if asked for anything but the quiz proves no library fetch happens.
    const result = await loadAndCheckQuiz(URL_, fetcherMap({ [URL_]: plain }));
    expect(result.ok).toBe(true);
  });

  it("FRAGMENT_NOT_FOUND for a reference to a missing fragment id", async () => {
    const quiz = quizWithFragments('  {{fragment "lib.nope"}}');
    const result = await loadAndCheckQuiz(URL_, fetcherMap({ [URL_]: quiz, [LIB_URL]: LIB_YAML }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain("FRAGMENT_NOT_FOUND");
  });

  it("UNKNOWN_FRAGMENT_FILE_ALIAS for a reference to an undeclared file alias", async () => {
    const quiz = quizWithFragments('  {{fragment "other.safety"}}');
    const result = await loadAndCheckQuiz(URL_, fetcherMap({ [URL_]: quiz, [LIB_URL]: LIB_YAML }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.map((e) => e.code)).toContain("UNKNOWN_FRAGMENT_FILE_ALIAS");
  });

  it("MISSING_REQUIRED_VARIABLE when a required fragment variable is not supplied", async () => {
    const quiz = quizWithFragments('  {{fragment "lib.lang"}}');
    const result = await loadAndCheckQuiz(URL_, fetcherMap({ [URL_]: quiz, [LIB_URL]: LIB_YAML }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain("MISSING_REQUIRED_VARIABLE");
  });

  it("VARIABLE_TYPE_MISMATCH when a fragment variable has the wrong type", async () => {
    const quiz = quizWithFragments('  {{fragment "lib.lang" language=(array "not" "a" "string")}}');
    const result = await loadAndCheckQuiz(URL_, fetcherMap({ [URL_]: quiz, [LIB_URL]: LIB_YAML }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("still catches duplicate question ids alongside a valid fragment block", async () => {
    const quiz = `
id: q
llm:
  model: m
fragment_files:
  - id: lib
    url: ${LIB_URL}
instructions: |
  {{fragment "lib.safety"}}
questions:
  - id: dup
    question: "Q1?"
    evaluation: "grade"
  - id: dup
    question: "Q2?"
    evaluation: "grade"
`;
    const result = await loadAndCheckQuiz(URL_, fetcherMap({ [URL_]: quiz, [LIB_URL]: LIB_YAML }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("DUPLICATE_QUIZ_QUESTION_ID");
  });
});
