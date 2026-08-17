import type { ModelWithRetries } from "@mastra/core/agent";
import { resolveLanguageModel } from "@/lib/llm/model";
import type { LlmProvider, ReasoningLevel } from "@/lib/llm/provider";

// What EVERY agent's `model:` resolver in this folder returns. The single home of
// the reasoning-effort wiring on the agent path (docs/ai-models.md).
//
// Mastra's `model:` accepts either a bare model or a `ModelWithRetries[]` — and
// only the ARRAY form carries per-entry `providerOptions` into the run (the
// bare-model path drops them). So a resolver that may pin a reasoning effort must
// return the array form, even for the single-model case we always have here.
//
// The provider-options key is literally `"openai"` for BOTH of our providers: the
// @ai-sdk/openai package reads its options under that FIXED key regardless of the
// `createOpenAI({ name })` instance name (`scch` / `azure-foundry`), then maps
// `reasoningEffort` onto the wire parameter `reasoning_effort`. An absent level
// emits NO providerOptions at all, so the model's own default applies.
export function modelEntry(
  provider: LlmProvider,
  model: string,
  reasoning?: ReasoningLevel,
): ModelWithRetries[] {
  return [
    {
      model: resolveLanguageModel(provider, model),
      ...(reasoning ? { providerOptions: { openai: { reasoningEffort: reasoning } } } : {}),
    },
  ];
}
