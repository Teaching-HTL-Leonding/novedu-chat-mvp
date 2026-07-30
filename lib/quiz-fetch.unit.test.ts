import { beforeEach, describe, expect, it, vi } from "vitest";

// loadQuiz renders the quiz-level `instructions` host text (with inline `{{fragment}}`
// markers resolved) into the server-only `Quiz.instructionsPreamble`. Hermetic: the
// app-hosted seam is mocked to serve fixture YAML from an in-process map (no DB, no
// network), keyed by URL.

const state = vi.hoisted(() => ({ bodies: {} as Record<string, string> }));

vi.mock("@/lib/app-origin", () => ({ resolveAppOriginOr: async () => "https://app.test" }));
vi.mock("@/lib/app-hosted-fetcher", () => ({
  appHostedFetcher: () => async (url: string) => {
    const text = state.bodies[url];
    return text === undefined
      ? { ok: false as const, status: 404, text: async () => "" }
      : { ok: true as const, status: 200, text: async () => text };
  },
}));

import { loadQuiz } from "@/lib/quiz-fetch";
import { toPublicQuiz } from "@/lib/quiz-yaml";

const QUIZ_URL = "https://app.test/api/files/quiz";
const LIB_URL = "https://example.com/lib.yaml";
const LIB_YAML = `id: lib
fragments:
  - id: safety
    version: 1
    content: |
      SAFETY-MARKER be kind.
  - id: lang
    input_schema:
      type: object
      required: [language]
      properties:
        language:
          type: string
    content: |
      LANG-MARKER respond in {{language}}.
`;

const quizYaml = (extra = "") => `
id: q
llm:
  model: m
${extra}
questions:
  - id: a
    question: "Q?"
    evaluation: "grade"
`;

// The library reference + an `instructions` host text that places LANG before SAFETY.
const withFragments = (instructions: string) => `fragment_files:
  - id: lib
    url: ${LIB_URL}
instructions: |
${instructions}`;

beforeEach(() => {
  state.bodies = {};
});

describe("loadQuiz — instructionsPreamble", () => {
  it("renders the instructions host text with fragments placed where their markers sit", async () => {
    state.bodies = {
      [QUIZ_URL]: quizYaml(
        withFragments('  {{fragment "lib.lang" language="German"}}\n\n  {{fragment "lib.safety"}}'),
      ),
      [LIB_URL]: LIB_YAML,
    };
    const result = await loadQuiz(QUIZ_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quiz.instructionsPreamble).toContain("SAFETY-MARKER");
      expect(result.quiz.instructionsPreamble).toContain("LANG-MARKER respond in German.");
      // Textual placement: the lang marker sits before the safety marker.
      expect(result.quiz.instructionsPreamble.indexOf("LANG-MARKER")).toBeLessThan(
        result.quiz.instructionsPreamble.indexOf("SAFETY-MARKER"),
      );
    }
  });

  it("leaves the preamble empty for a plain quiz (no fragments) and does not leak it", async () => {
    state.bodies = { [QUIZ_URL]: quizYaml() };
    const result = await loadQuiz(QUIZ_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quiz.instructionsPreamble).toBe("");
      // The public projection never carries the server-only fragment fields.
      const pub = toPublicQuiz(result.quiz);
      expect(pub).not.toHaveProperty("instructionsPreamble");
      expect(pub).not.toHaveProperty("instructions");
      expect(pub).not.toHaveProperty("fragmentBlock");
    }
  });

  it("fails closed when a referenced fragment library cannot be fetched", async () => {
    state.bodies = {
      // The library URL is intentionally absent → 404 on the fragment fetch.
      [QUIZ_URL]: quizYaml(withFragments('  {{fragment "lib.safety"}}')),
    };
    const result = await loadQuiz(QUIZ_URL);
    expect(result.ok).toBe(false);
  });

  it("does not leak a NON-empty rendered preamble through toPublicQuiz", async () => {
    state.bodies = {
      [QUIZ_URL]: quizYaml(withFragments('  {{fragment "lib.safety"}}')),
      [LIB_URL]: LIB_YAML,
    };
    const result = await loadQuiz(QUIZ_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Guard: the preamble really is non-empty, so the projection is exercised on the
      // path that matters (an all-empty preamble would strip trivially).
      expect(result.quiz.instructionsPreamble).toContain("SAFETY-MARKER");
      const pub = toPublicQuiz(result.quiz);
      expect(pub).not.toHaveProperty("instructionsPreamble");
      expect(pub).not.toHaveProperty("fragmentBlock");
      // The server-only fragment text must not appear ANYWHERE in the client projection.
      expect(JSON.stringify(pub)).not.toContain("SAFETY-MARKER");
    }
  });

  it("fails closed when a fragment file URL uses a disallowed scheme (SSRF gate)", async () => {
    // Even though the mocked fetcher WOULD serve this URL, the http(s)-only scheme gate
    // must reject it BEFORE any fetch — the runtime lenient reader skips the Zod URL
    // refine that guards the tutor path, so the gate in `assembleFragmentPrompt` is the
    // structural backstop.
    const BAD_URL = "file:///etc/passwd";
    state.bodies = {
      [BAD_URL]: LIB_YAML,
      [QUIZ_URL]: quizYaml(`fragment_files:
  - id: lib
    url: ${BAD_URL}
instructions: |
  {{fragment "lib.safety"}}`),
    };
    const result = await loadQuiz(QUIZ_URL);
    expect(result.ok).toBe(false);
  });
});
