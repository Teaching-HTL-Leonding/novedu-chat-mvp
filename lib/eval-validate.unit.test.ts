// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadAndCheckEval } from "@/lib/eval-validate";
import type { Fetcher } from "@/lib/prompt-fragments";

// The eval-file check over a stub fetcher: issue paths, target resolution (relative
// and absolute, file: and http:), the unknown-question cross-check, and how a broken
// target quiz is surfaced. Fully offline — no fixtures server, no network.

const QUIZ = `id: sorting-quiz
llm:
  model: test-model
questions:
  - id: q1
    question: What is 2 + 2?
    evaluation: 4 is correct.
  - id: q2
    question: Name a sorting algorithm.
    evaluation: Any real one is correct.
`;

/** A fetcher serving a fixed URL→body map; anything else is a 404. */
function stubFetcher(files: Record<string, string>): Fetcher {
  return async (url) => {
    const body = files[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
}

const EVAL_URL = "https://example.com/evals/sorting.eval.yaml";
const QUIZ_URL = "https://example.com/quizzes/sorting-quiz.yaml";

const VALID_EVAL = `id: sorting-eval
target: ../quizzes/sorting-quiz.yaml
questions:
  - question: q1
    answers:
      - expect: correct
        answer: |
          4
      - expect: [partial, incorrect]
        answer: |
          Almost four.
`;

const schemes = ["http:", "https:", "file:"];

describe("loadAndCheckEval — happy path", () => {
  it("resolves the target relative to the eval file and dumps its grading prompts", async () => {
    const fetcher = stubFetcher({ [EVAL_URL]: VALID_EVAL, [QUIZ_URL]: QUIZ });

    const result = await loadAndCheckEval(EVAL_URL, fetcher, { allowedSchemes: schemes });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evalFile.id).toBe("sorting-eval");
    expect(result.targetUrl).toBe(QUIZ_URL);
    expect(result.caseCount).toBe(2);
    // The grading prompts come from the app's own dump seam, never a copy.
    expect(result.quizDump.grading.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(result.quizDump.grading.questions[0]?.system).toContain("4 is correct.");
  });

  it("accepts an absolute http target", async () => {
    const evalFile = VALID_EVAL.replace("../quizzes/sorting-quiz.yaml", QUIZ_URL);
    const fetcher = stubFetcher({ [EVAL_URL]: evalFile, [QUIZ_URL]: QUIZ });

    const result = await loadAndCheckEval(EVAL_URL, fetcher, { allowedSchemes: schemes });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.targetUrl).toBe(QUIZ_URL);
  });

  it("resolves a file: target next to a file: eval", async () => {
    const evalUrl = "file:///tmp/course/sorting.eval.yaml";
    const quizUrl = "file:///tmp/course/sorting-quiz.yaml";
    const evalFile = VALID_EVAL.replace("../quizzes/sorting-quiz.yaml", "./sorting-quiz.yaml");
    const fetcher = stubFetcher({ [evalUrl]: evalFile, [quizUrl]: QUIZ });

    const result = await loadAndCheckEval(evalUrl, fetcher, { allowedSchemes: schemes });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.targetUrl).toBe(quizUrl);
  });
});

describe("loadAndCheckEval — failures", () => {
  it("reports an unreadable eval as EVAL_READ", async () => {
    const result = await loadAndCheckEval(EVAL_URL, stubFetcher({}), {
      allowedSchemes: schemes,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("EVAL_READ");
  });

  it("reports unparseable YAML as EVAL_PARSE", async () => {
    const fetcher = stubFetcher({ [EVAL_URL]: "id: [unclosed\n" });

    const result = await loadAndCheckEval(EVAL_URL, fetcher, { allowedSchemes: schemes });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("EVAL_PARSE");
  });

  it("reports schema issues one per zod issue, each led by its dotted path", async () => {
    const broken = `id: sorting-eval
target: ../quizzes/sorting-quiz.yaml
questions:
  - question: q1
    answers:
      - expect: correct
        answer: |
          4
      - expect: nonsense
        answer: |
          hmm
`;
    const fetcher = stubFetcher({ [EVAL_URL]: broken, [QUIZ_URL]: QUIZ });

    const result = await loadAndCheckEval(EVAL_URL, fetcher, { allowedSchemes: schemes });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.every((e) => e.code === "EVAL_SCHEMA")).toBe(true);
    expect(result.errors.some((e) => e.message.startsWith("questions.0.answers.1.expect"))).toBe(
      true,
    );
  });

  it("rejects an unknown key (strict objects)", async () => {
    const broken = VALID_EVAL.replace("        answer: |", "        answr: |");
    const fetcher = stubFetcher({ [EVAL_URL]: broken, [QUIZ_URL]: QUIZ });

    const result = await loadAndCheckEval(EVAL_URL, fetcher, { allowedSchemes: schemes });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("EVAL_SCHEMA");
  });

  it("maps a quiz that will not load onto EVAL_TARGET_ERROR", async () => {
    const fetcher = stubFetcher({ [EVAL_URL]: VALID_EVAL });

    const result = await loadAndCheckEval(EVAL_URL, fetcher, { allowedSchemes: schemes });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("EVAL_TARGET_ERROR");
      expect(result.errors[0]?.url).toBe(QUIZ_URL);
    }
  });

  it("blocks a target whose scheme is not allowed", async () => {
    const evalFile = VALID_EVAL.replace(
      "../quizzes/sorting-quiz.yaml",
      "file:///etc/passwd-quiz.yaml",
    );
    const fetcher = stubFetcher({ [EVAL_URL]: evalFile });

    const result = await loadAndCheckEval(EVAL_URL, fetcher, {
      allowedSchemes: ["http:", "https:"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("EVAL_TARGET_ERROR");
  });

  it("cross-checks every question id against the RESOLVED quiz pool", async () => {
    const evalFile = VALID_EVAL.replace("question: q1", "question: q9");
    const fetcher = stubFetcher({ [EVAL_URL]: evalFile, [QUIZ_URL]: QUIZ });

    const result = await loadAndCheckEval(EVAL_URL, fetcher, { allowedSchemes: schemes });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("EVAL_UNKNOWN_QUESTION");
      expect(result.errors[0]?.questionId).toBe("q9");
    }
  });
});

describe("loadAndCheckEval — strictTarget", () => {
  // Without `strictTarget` the LENIENT runtime load is used (what the grader really
  // gets); `validate --kind eval` opts into the same strict authoring check
  // `validate --kind quiz` runs, so it never asserts less about the quiz.
  const DUPLICATE_ID_QUIZ = `id: sorting-quiz
llm:
  model: test-model
questions:
  - id: q1
    question: What is 2 + 2?
    evaluation: 4 is correct.
  - id: q1
    question: Duplicate id.
    evaluation: Also 4.
`;

  it("passes the lenient path but fails the strict one on a duplicate question id", async () => {
    const fetcher = stubFetcher({ [EVAL_URL]: VALID_EVAL, [QUIZ_URL]: DUPLICATE_ID_QUIZ });

    const lenient = await loadAndCheckEval(EVAL_URL, fetcher, { allowedSchemes: schemes });
    expect(lenient.ok).toBe(true);

    const strict = await loadAndCheckEval(EVAL_URL, fetcher, {
      allowedSchemes: schemes,
      strictTarget: true,
    });
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.errors[0]?.code).toBe("DUPLICATE_QUIZ_QUESTION_ID");
  });
});
