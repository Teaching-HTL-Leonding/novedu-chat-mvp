import type { ModelWithRetries } from "@mastra/core/agent";
import { reasoningOptionsKey, resolveLanguageModel } from "@/lib/llm/model";
import type { LlmProvider, ReasoningLevel } from "@/lib/llm/provider";

// What EVERY agent's `model:` resolver in this folder returns. The single home of
// the reasoning-effort wiring on the agent path (docs/ai-models.md).
//
// Mastra's `model:` accepts either a bare model or a `ModelWithRetries[]` — and
// only the ARRAY form carries per-entry `providerOptions` into the run (the
// bare-model path drops them). So a resolver that may pin a reasoning effort must
// return the array form, even for the single-model case we always have here.
//
// WHERE the level goes is the ai-sdk package's business, so the key comes from
// `reasoningOptionsKey` next to `resolveLanguageModel` (lib/llm/model.ts). An
// absent level emits NO providerOptions at all, so the model's own default
// applies.
export function modelEntry(
  provider: LlmProvider,
  model: string,
  reasoning?: ReasoningLevel,
): ModelWithRetries[] {
  return [
    {
      model: resolveLanguageModel(provider, model),
      ...(reasoning
        ? {
            providerOptions: {
              [reasoningOptionsKey(provider)]: { reasoningEffort: reasoning },
            },
          }
        : {}),
    },
  ];
}
