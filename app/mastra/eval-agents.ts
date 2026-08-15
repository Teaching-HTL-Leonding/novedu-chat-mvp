import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { resolveLanguageModel } from "@/lib/llm/model";
import { DEFAULT_PROVIDER, type LlmProvider, parseLenientProvider } from "@/lib/llm/provider";

// The agent behind the teacher-only eval JUDGE (`POST /api/eval/judge`,
// docs/cli-eval.md): an LLM that audits the TEXT a grader wrote — the half of the
// verdict the eval's `expect` gating never looks at — against the very system prompt
// that grader ran with.
//
// Configured ENTIRELY per request from the RequestContext, exactly like the quiz agents:
// the caller brings the judge system prompt and the provider/model pair. It is
// deliberately KIND-AGNOSTIC — nothing here knows about quizzes — so the eval kinds still
// to come reuse it with no change (the criteria travel in the route's request body and
// become the structured-output enum there).
//
// SERVER-ONLY: resolves models through the `lib/llm` seam.
//
// SECURITY: like `quizEvaluator`, `evalJudge` is registered in `app/mastra/index.ts` but
// is NEVER web-reachable by students — the CopilotKit runtime route only ever accepts the
// ONE agent id its code's module declares, so every other id 404s. Its only caller is the
// `requireBearerTeacher`-gated judge route (AGENTS.md, docs/codes.md).

// RequestContext keys, distinct from the quiz agents' so a request for one can never
// satisfy the other (defense in depth on top of the runtime route's agent gating).
export const EVAL_JUDGE_INSTRUCTIONS = "eval-judge-instructions";
export const EVAL_JUDGE_MODEL = "eval-judge-model";
export const EVAL_JUDGE_PROVIDER = "eval-judge-provider";

function requiredString(requestContext: RequestContext, key: string): string {
  const value = requestContext.get(key);
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing "${key}" on the request context for the eval judge agent.`);
  }
  return value;
}

// An absent provider key means SCCH (matching the YAML default); the route already
// rejected an invalid value, so lenient reading here is safe.
function providerFrom(requestContext: RequestContext, key: string): LlmProvider {
  return parseLenientProvider(requestContext.get(key)) ?? DEFAULT_PROVIDER;
}

// STATELESS: no `Memory`, so a `generate()` call persists nothing — the same privacy
// property the grader has. Nothing about an eval run is ever stored.
export const evalJudgeAgent = new Agent({
  id: "evalJudge",
  name: "Eval Judge",
  instructions: ({ requestContext }) => requiredString(requestContext, EVAL_JUDGE_INSTRUCTIONS),
  model: ({ requestContext }) =>
    resolveLanguageModel(
      providerFrom(requestContext, EVAL_JUDGE_PROVIDER),
      requiredString(requestContext, EVAL_JUDGE_MODEL),
    ),
});
