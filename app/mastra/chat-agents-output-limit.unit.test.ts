import { describe, expect, it, vi } from "vitest";

// The output cap's wiring on the quiz and writing agents (the tutor's lives in
// tutor-agent.unit.test.ts): the student-facing chats carry it for the provider
// on their request context, the quiz GRADER carries none (its truncation is
// handled by lib/quiz-truncation-retry.ts). The cap's own rules are in
// output-limit.unit.test.ts. Mastra's Agent is replaced by a config capture.

vi.mock("@mastra/core/agent", () => ({
  Agent: class {
    config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
  },
}));
vi.mock("@mastra/memory", () => ({ Memory: class {} }));
vi.mock("@/lib/llm/model", () => ({
  resolveLanguageModel: vi.fn(),
  reasoningOptionsKey: vi.fn(),
}));

import { chatMaxOutputTokens } from "@/lib/limits/resolve";
import { LIMITS_EXEMPT } from "./output-limit";
import { QUIZ_DISCUSSION_PROVIDER, quizDiscussionAgent, quizEvaluatorAgent } from "./quiz-agents";
import { WRITING_PROVIDER, writingAgent } from "./writing-agents";

type Options = { modelSettings?: { maxOutputTokens?: number } };
type Resolver = (args: { requestContext: unknown }) => Options;

const configOf = (agent: unknown) => (agent as { config: Record<string, unknown> }).config;

function requestContext(values: Record<string, unknown>) {
  const m = new Map(Object.entries(values));
  return { get: (key: string) => m.get(key) };
}

describe.each([
  { name: "quizDiscussion", agent: quizDiscussionAgent, providerKey: QUIZ_DISCUSSION_PROVIDER },
  { name: "writing", agent: writingAgent, providerKey: WRITING_PROVIDER },
])("$name output cap", ({ agent, providerKey }) => {
  const defaultOptions = configOf(agent).defaultOptions as Resolver;

  it("caps for the default provider when the context names none", () => {
    const options = defaultOptions({ requestContext: requestContext({}) });
    expect(options.modelSettings?.maxOutputTokens).toBe(chatMaxOutputTokens("SCCH"));
  });

  it("caps for the effective provider on the context", () => {
    const options = defaultOptions({
      requestContext: requestContext({ [providerKey]: "Azure Foundry" }),
    });
    expect(options.modelSettings?.maxOutputTokens).toBe(chatMaxOutputTokens("Azure Foundry"));
  });

  it("does not cap an exempt caller", () => {
    expect(defaultOptions({ requestContext: requestContext({ [LIMITS_EXEMPT]: true }) })).toEqual(
      {},
    );
  });
});

it("the quiz grader carries no output cap", () => {
  expect(configOf(quizEvaluatorAgent).defaultOptions).toBeUndefined();
});
