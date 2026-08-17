import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import {
  DEFAULT_PROVIDER,
  type LlmProvider,
  parseLenientProvider,
  parseLenientReasoningLevel,
} from "@/lib/llm/provider";
import { modelEntry } from "./model-entry";
import { selectTutorTools } from "./tutor-tools";

// The two agents behind the teacher-only eval endpoints (docs/cli-eval.md):
//
//   evalJudge  (`POST /api/eval/judge`)   — audits a piece of model output against the
//                                           very system prompt that produced it.
//   evalTutor  (`POST /api/eval/respond`) — generates ONE tutor turn for a scripted
//                                           conversation, so a tutor eval measures a
//                                           real response rather than a mock.
//
// Both are configured ENTIRELY per request from the RequestContext, exactly like the quiz
// agents: the caller brings the system prompt and the provider/model pair (and, for the
// tutor, the tool grant). `evalJudge` is deliberately KIND-AGNOSTIC — nothing here knows
// about quizzes or tutors — so a further eval kind reuses it with no change (the criteria
// travel in the route's request body and become the structured-output enum there).
//
// SERVER-ONLY: resolves models through the `lib/llm` seam.
//
// SECURITY: like `quizEvaluator`, `evalJudge` and `evalTutor` are registered in
// `app/mastra/index.ts` but are NEVER web-reachable by students — the CopilotKit runtime
// route only ever accepts the ONE agent id its code's module declares, so every other id
// 404s. Their only callers are the `requireBearerTeacher`-gated eval routes (AGENTS.md,
// docs/codes.md).

// RequestContext keys, distinct from the quiz agents' so a request for one can never
// satisfy the other (defense in depth on top of the runtime route's agent gating).
export const EVAL_JUDGE_INSTRUCTIONS = "eval-judge-instructions";
export const EVAL_JUDGE_MODEL = "eval-judge-model";
export const EVAL_JUDGE_PROVIDER = "eval-judge-provider";
/** Optional reasoning effort for the judge; absent = the model's own default. */
export const EVAL_JUDGE_REASONING = "eval-judge-reasoning";

// The tutor-generation agent's own keys, distinct again for the same reason.
export const EVAL_TUTOR_INSTRUCTIONS = "eval-tutor-instructions";
export const EVAL_TUTOR_MODEL = "eval-tutor-model";
export const EVAL_TUTOR_PROVIDER = "eval-tutor-provider";
/** Optional reasoning effort for the tutor under test; absent = the model's default. */
export const EVAL_TUTOR_REASONING = "eval-tutor-reasoning";
/** The tutor's `tools:` grant for this run, as the catalog names the route validated. */
export const EVAL_TUTOR_TOOLS = "eval-tutor-tools";

function requiredString(requestContext: RequestContext, key: string): string {
  const value = requestContext.get(key);
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing "${key}" on the request context for the eval judge agent.`);
  }
  return value;
}

// An absent provider key means SCCH (matching the YAML default); the route already
// rejected an invalid value, so lenient reading here is safe. The reasoning key is
// read the same way at each resolver: absent pins no effort.
function providerFrom(requestContext: RequestContext, key: string): LlmProvider {
  return parseLenientProvider(requestContext.get(key)) ?? DEFAULT_PROVIDER;
}

// The tool grant off the context. The ROUTE already rejected an unknown name with a
// terminal 400, so anything arriving here is a catalog name; a non-array is a wiring bug
// and fails loud rather than silently running the tutor tool-less.
function toolNames(requestContext: RequestContext, key: string): string[] {
  const value = requestContext.get(key);
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string")) {
    throw new Error(`"${key}" on the request context must be a list of tool names.`);
  }
  return value as string[];
}

// STATELESS: no `Memory`, so a `generate()` call persists nothing — the same privacy
// property the grader has. Nothing about an eval run is ever stored.
export const evalJudgeAgent = new Agent({
  id: "evalJudge",
  name: "Eval Judge",
  instructions: ({ requestContext }) => requiredString(requestContext, EVAL_JUDGE_INSTRUCTIONS),
  model: ({ requestContext }) =>
    modelEntry(
      providerFrom(requestContext, EVAL_JUDGE_PROVIDER),
      requiredString(requestContext, EVAL_JUDGE_MODEL),
      parseLenientReasoningLevel(requestContext.get(EVAL_JUDGE_REASONING)),
    ),
});

/**
 * The tutor under test, for `POST /api/eval/respond`. Memory-less on purpose: a tutor
 * eval scripts the WHOLE conversation and asks for exactly one more turn, so recalled
 * history would make the run non-deterministic and would persist a teacher's synthetic
 * dialogue into the `mastra_*` tables. The tools are the real catalog instances the
 * runtime binds (`selectTutorTools`), so a tool-using tutor is evaluated on the path it
 * actually runs — executors are pure / injected-effect, and the run is teacher-initiated.
 */
export const evalTutorAgent = new Agent({
  id: "evalTutor",
  name: "Eval Tutor",
  instructions: ({ requestContext }) => requiredString(requestContext, EVAL_TUTOR_INSTRUCTIONS),
  model: ({ requestContext }) =>
    modelEntry(
      providerFrom(requestContext, EVAL_TUTOR_PROVIDER),
      requiredString(requestContext, EVAL_TUTOR_MODEL),
      parseLenientReasoningLevel(requestContext.get(EVAL_TUTOR_REASONING)),
    ),
  tools: ({ requestContext }) => selectTutorTools(toolNames(requestContext, EVAL_TUTOR_TOOLS)),
});
