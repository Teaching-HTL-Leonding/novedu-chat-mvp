import type { LlmProvider, ReasoningLevel } from "@/lib/llm/provider";

// The built-in LLM-override presets the code create/edit form offers as
// one-click fills for its free-text provider/model fields (docs/codes.md). Pure
// and CLIENT-SAFE (the form is a client component). These are conveniences, not
// an allowlist — the form fields stay free text and the server validates the
// provider against `parseLenientProvider`; a preset going stale (a model
// retired upstream) only makes the button less useful, it gates nothing.

export interface LlmOverridePreset {
  /** Button label on the code form. */
  label: string;
  provider: LlmProvider;
  model: string;
  /**
   * Reasoning effort to fill in with the pair. Absent on a preset for a
   * non-reasoning model — the form then clears the level, so the button always
   * fills the WHOLE override (docs/codes.md).
   */
  reasoning?: ReasoningLevel;
}

export const LLM_OVERRIDE_PRESETS: readonly LlmOverridePreset[] = [
  { label: "SCCH · Gemma 4", provider: "SCCH", model: "RedHatAI/gemma-4-31B-it-FP8-Dynamic" },
  { label: "Azure Foundry · gpt-5.4-mini", provider: "Azure Foundry", model: "gpt-5.4-mini" },
  // A reasoning model: "low" is the fast classroom default (the level is a
  // parameter here, not a separate deployment as on SCCH).
  {
    label: "Azure Foundry · gpt-5.6-terra",
    provider: "Azure Foundry",
    model: "gpt-5.6-terra",
    reasoning: "low",
  },
  // The reasoning variant; SCCH also serves a "… - Reasoning OFF" sibling.
  { label: "SCCH · Qwen 3.8 27B", provider: "SCCH", model: "Qwen/Qwen3.8-27B-FP8" },
  // OpenRouter models are namespaced `<vendor>/<model>` — the id is the routing key.
  { label: "OpenRouter · GLM 5.3 Flash", provider: "OpenRouter", model: "z-ai/glm-5.3-flash" },
];
