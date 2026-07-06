import type { LlmProvider } from "@/lib/llm/provider";

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
}

export const LLM_OVERRIDE_PRESETS: readonly LlmOverridePreset[] = [
  { label: "SCCH · Gemma 4", provider: "SCCH", model: "RedHatAI/gemma-4-31B-it-FP8-Dynamic" },
  { label: "Azure Foundry · gpt-5.4-mini", provider: "Azure Foundry", model: "gpt-5.4-mini" },
];
