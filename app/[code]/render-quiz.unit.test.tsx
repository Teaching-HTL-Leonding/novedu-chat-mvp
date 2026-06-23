// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The quiz module's student render: it loads + leniently parses the quiz YAML from
// the code's file_url and renders the runner (with ONLY student-facing fields), or
// a notice when the quiz cannot be opened. Invoked directly (it is an async server
// component) with the loader mocked, so no DB/LLM; runs in CI.

const loadQuiz = vi.hoisted(() => vi.fn());

vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz }));
// toPublicQuiz strips the server-only `evaluation`; the stub passes the quiz
// through so the test exercises render-quiz, not the strip (covered elsewhere).
vi.mock("@/lib/quiz-yaml", () => ({ toPublicQuiz: (q: unknown) => q }));
vi.mock("./_quiz/quiz-runner", () => ({
  QuizRunner: ({ code }: { code: string }) => <div data-testid="runner">quiz for {code}</div>,
}));

import type { CodeEntry } from "@/lib/code-store";
import { RenderQuiz } from "./render-quiz";

const entry = {
  code: "a1b2c3d4e5",
  module: "quiz",
  fileUrl: "https://example.com/api/files/q",
} as unknown as CodeEntry;

async function render() {
  const element = await RenderQuiz({ entry, code: "a1b2c3d4e5" });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RenderQuiz", () => {
  it("loadable quiz → renders the runner scoped to the code", async () => {
    loadQuiz.mockResolvedValue({ ok: true, quiz: { questions: [] } });
    const html = await render();
    expect(html).toContain("quiz for a1b2c3d4e5");
  });

  it("unloadable quiz → renders the notice with the reason, not the runner", async () => {
    loadQuiz.mockResolvedValue({ ok: false, message: "Quiz file is unreachable." });
    const html = await render();
    expect(html).toContain("This quiz cannot be opened");
    expect(html).toContain("Quiz file is unreachable.");
    expect(html).not.toContain('data-testid="runner"');
  });
});
