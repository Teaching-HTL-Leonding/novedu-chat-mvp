import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { scchProvider } from "./scch";

// Two agents that back the Quizzes feature. Both are configured ENTIRELY per
// request from values the caller places on the `RequestContext` (the quiz's
// model, and the system prompt the caller built) — mirroring how `tutorAgent`
// resolves its prompt/model per request, but without the tutor-YAML coupling.
// Going through Mastra (rather than calling the model SDK directly) keeps these
// portable to the planned multi-provider model seam.
//
// SERVER-ONLY: resolves models against the self-hosted endpoint via `scch`.

// The grader's structured verdict. The self-hosted vLLM endpoint honors
// OpenAI-compatible `response_format: json_schema` (verified against gemma-4 at
// design time), which is exactly what Mastra emits for `structuredOutput` — so
// no `jsonPromptInjection` fallback is needed. Kept terse; the student sees the
// mapped wording from `verdictLabel`, never these raw values.
export const QUIZ_VERDICT_SCHEMA = z.object({
  result: z.enum(["correct", "partial", "incorrect"]),
  feedback: z.string(),
});

// RequestContext keys. Distinct per agent so a request for one can never satisfy
// the other (defense in depth on top of the runtime route's agent gating).
export const QUIZ_EVAL_INSTRUCTIONS = "quiz-eval-instructions";
export const QUIZ_EVAL_MODEL = "quiz-eval-model";
export const QUIZ_DISCUSSION_INSTRUCTIONS = "quiz-discussion-instructions";
export const QUIZ_DISCUSSION_MODEL = "quiz-discussion-model";

function requiredString(requestContext: RequestContext, key: string): string {
  const value = requestContext.get(key);
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing "${key}" on the request context for the quiz agent.`);
  }
  return value;
}

// STATELESS grader: no `Memory`, so a `generate()` call persists nothing (the
// privacy promise — "we do NOT record quiz sessions"). The caller (the
// `submitAnswer` action) builds the full grading system prompt (frame + the
// question's server-only `evaluation` prompt) and passes the student's answer as
// the input message, then reads the structured `{ result, feedback }`.
export const quizEvaluatorAgent = new Agent({
  id: "quizEvaluator",
  name: "Quiz Evaluator",
  instructions: ({ requestContext }) => requiredString(requestContext, QUIZ_EVAL_INSTRUCTIONS),
  model: ({ requestContext }) => scchProvider.chat(requiredString(requestContext, QUIZ_EVAL_MODEL)),
});

// The per-question discussion chat. Memory-backed exactly like `tutorAgent`
// (recent-message window, no semantic recall) so a thread persists and earlier
// turns reach the model through the recalled window after `trimToNewTurn`. The
// runtime route sets the system prompt (the quiz's `discussion.instructions`)
// and model, and scopes memory to `resourceId = the quiz URL`.
export const quizDiscussionAgent = new Agent({
  id: "quizDiscussion",
  name: "Quiz Discussion",
  instructions: ({ requestContext }) =>
    requiredString(requestContext, QUIZ_DISCUSSION_INSTRUCTIONS),
  model: ({ requestContext }) =>
    scchProvider.chat(requiredString(requestContext, QUIZ_DISCUSSION_MODEL)),
  memory: new Memory({
    options: {
      lastMessages: 40,
      semanticRecall: false,
    },
  }),
});
