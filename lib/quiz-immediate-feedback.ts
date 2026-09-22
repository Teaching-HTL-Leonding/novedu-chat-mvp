import { openrouterConfigured } from "@/lib/llm/openrouter-endpoint";

// The server-side feature gate for the quiz pre-check (docs/codes.md, "Immediate
// feedback"). Two conditions, both required: an operator opts in with
// `QUIZ_IMMEDIATE_FEEDBACK=true`, and the classifier's transport is reachable —
// Jev rides OpenRouter's key, so `openrouterConfigured()` is the second half.
// Anything but a case-insensitive `true` (surrounding whitespace tolerated, as
// `.env` files collect it) means off: an experiment defaults to off, and `1` /
// `yes` staying off is better than a half-meant value silently spending money.
//
// SERVER-ONLY and APP-ONLY, exactly like `lib/llm/availability.ts`: the
// @novedu/cli bundles the quiz validation core, which must stay env-free, so
// nothing CLI-bundled may import this module. The client learns the EFFECTIVE
// flag only through `QuizPublic.immediateFeedback`, and `precheckAnswer`
// re-derives it here on every call rather than trusting that copy.

const flagOn = (): boolean => process.env.QUIZ_IMMEDIATE_FEEDBACK?.trim().toLowerCase() === "true";

/** True when the server may pre-check answers at all — the flag AND the key. */
export function immediateFeedbackConfigured(): boolean {
  return flagOn() && openrouterConfigured();
}

/**
 * Flag set but no `OPENROUTER_API_KEY` — an operator who meant to enable the
 * feature and would otherwise see nothing happen. Worth exactly one boot warning
 * (instrumentation.ts); the feature behaves as off.
 */
export function immediateFeedbackMisconfigured(): boolean {
  return flagOn() && !openrouterConfigured();
}
