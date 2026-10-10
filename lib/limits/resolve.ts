import type { LlmProvider } from "@/lib/llm/provider";
import { LIMITS, type LimitsConfig } from "./config";

// Pure resolvers over the limits config: the EFFECTIVE provider's entry first,
// then the defaults. They answer "what is the limit", never "does it apply" —
// that is `isLimitExempt` (lib/limits/enabled.ts). The config parameter exists
// for tests; production callers use the default.

/** Per-response output cap of the student-facing chat agents. */
export function chatMaxOutputTokens(
  provider: LlmProvider,
  config: Readonly<LimitsConfig> = LIMITS,
): number {
  return config.providers[provider].chatMaxOutputTokens ?? config.defaults.chatMaxOutputTokens;
}

/** Upper bound on the coding proxy's `max_tokens` / `max_completion_tokens`. */
export function codingMaxOutputTokens(
  provider: LlmProvider,
  config: Readonly<LimitsConfig> = LIMITS,
): number {
  return config.providers[provider].codingMaxOutputTokens ?? config.defaults.codingMaxOutputTokens;
}

/** Text characters one student chat turn may carry. Provider-independent. */
export function chatMaxInputChars(config: Readonly<LimitsConfig> = LIMITS): number {
  return config.defaults.chatMaxInputChars;
}
