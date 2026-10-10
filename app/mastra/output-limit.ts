import type { AgentExecutionOptions } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { chatMaxOutputTokens } from "@/lib/limits/resolve";
import type { LlmProvider } from "@/lib/llm/provider";
import { emitEvent } from "@/lib/telemetry";
import { USAGE_MODULE } from "@/lib/usage-context-keys";

// The per-response OUTPUT CAP of the student-facing chat agents (tutor, quiz
// discussion, writing — docs/chat.md). It bounds a single, extremely expensive
// answer or a runaway generation; it is NOT a quota. Wired as each agent's
// `defaultOptions`, which Mastra deep-merges under the options @ag-ui/mastra
// passes to `stream()` — that call sets no `modelSettings` of its own, so the
// cap always reaches the model.
//
// NOT used by the quiz grader (`quizEvaluatorAgent` handles its own truncation,
// lib/quiz-truncation-retry.ts) or the teacher-only eval agents.

/**
 * RequestContext key the CopilotKit route sets to `true` for a caller no limit
 * applies to (an effective teacher, or `LIMITS_ENABLED=false` —
 * `isLimitExempt`). FAIL-CLOSED: anything but `true`, including an absent key,
 * means the cap applies.
 */
export const LIMITS_EXEMPT = "limitsExempt";

/** Telemetry event for a reply cut off by the output cap. Content-free. */
export const OUTPUT_TRUNCATED_EVENT = "limits.output.truncated";

type FinishEvent = { finishReason?: string; steps?: Array<{ finishReason?: string }> };

/** True when the run — or any of its steps — stopped because it hit the token cap. */
export function hitOutputCap(event: FinishEvent): boolean {
  return (
    event.finishReason === "length" ||
    (event.steps ?? []).some((step) => step.finishReason === "length")
  );
}

/**
 * The `defaultOptions` of a student-facing chat agent: `maxOutputTokens` for the
 * EFFECTIVE provider (after a code's LLM override) plus a finish hook that
 * records a truncated reply. An exempt caller gets no options at all.
 */
export function chatOutputLimitOptions(
  requestContext: RequestContext,
  provider: LlmProvider,
): AgentExecutionOptions {
  if (requestContext.get(LIMITS_EXEMPT) === true) return {};
  const maxOutputTokens = chatMaxOutputTokens(provider);
  const module = requestContext.get(USAGE_MODULE);
  return {
    modelSettings: { maxOutputTokens },
    onFinish: (event) => {
      if (!hitOutputCap(event)) return;
      // Content-free: the module, the provider and the cap — never the reply.
      emitEvent(OUTPUT_TRUNCATED_EVENT, {
        module: typeof module === "string" ? module : "unknown",
        provider,
        maxOutputTokens,
      });
    },
  };
}
