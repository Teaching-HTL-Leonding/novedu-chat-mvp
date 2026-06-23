// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The tutor module's student render: it loads + builds the tutor prompt from the
// code's file_url and renders the chat, or shows the validation errors on a broken
// tutor. Invoked directly (it is an async server component) with the loader
// mocked, so no DB/LLM; runs in CI.

const loadAndBuildTutorPrompt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tutors", () => ({
  loadAndBuildTutorPrompt,
  defaultFetcher: {},
  sampleExampleQuestions: (q: unknown) => q ?? [],
}));
// Stub the chat so the happy path needs no CopilotKit/runtime.
vi.mock("../tutor-chat", () => ({
  TutorChat: ({ code }: { code: string }) => <div data-testid="chat">chat for {code}</div>,
}));

import type { CodeEntry } from "@/lib/code-store";
import { RenderTutor } from "./render-tutor";

const entry = {
  code: "a1b2c3d4e5",
  module: "tutor",
  fileUrl: "https://example.com/t.yaml",
} as unknown as CodeEntry;

async function render() {
  const element = await RenderTutor({
    entry,
    code: "a1b2c3d4e5",
    threadId: "t1",
    threadToken: "tok",
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RenderTutor", () => {
  it("valid + loadable tutor → renders the chat", async () => {
    loadAndBuildTutorPrompt.mockResolvedValue({
      ok: true,
      prompt: "system prompt",
      warnings: [],
      imageInput: true,
      title: "Tutor",
      description: "",
      exampleQuestions: [],
    });
    const html = await render();
    expect(html).toContain("chat for a1b2c3d4e5");
  });

  it("broken tutor → renders the load-failure notice and error list, no chat", async () => {
    loadAndBuildTutorPrompt.mockResolvedValue({
      ok: false,
      errors: [{ code: "MISSING_REQUIRED_VARIABLE", message: "Required variable missing." }],
      warnings: [],
    });
    const html = await render();
    expect(html).toContain("This tutor cannot be loaded");
    expect(html).toContain("MISSING_REQUIRED_VARIABLE");
    expect(html).not.toContain('data-testid="chat"');
  });
});
