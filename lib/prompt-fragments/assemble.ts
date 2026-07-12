// Handlebars assembly of the final system prompt. Pure: takes the resolved,
// already-validated render plan and produces the prompt string.

import Handlebars from "handlebars";
import type { ResolvedFragment } from "./consistency";

// `noEscape`: the output is a markdown/LLM prompt, not HTML — ASCII diagrams
//   (`<-`, `->`), ampersands, and quotes must pass through verbatim.
// `strict`: referencing an undeclared variable throws instead of silently
//   rendering empty. Consistency checking already guarantees required inputs, so
//   a throw here is a backstop that the caller surfaces as `ASSEMBLY_ERROR`.
// Exported so the standalone fragment check (`fragment.ts`) renders with the EXACT
// same semantics as real assembly — that identity is what makes "valid as a
// standalone fragment" mean "will render inside a tutor".
export const COMPILE_OPTIONS = { strict: true, noEscape: true } as const;

/**
 * Render each fragment in priority order and, when provided, append the caller's
 * trailing instructions last (they carry no priority, so "after everything" is the
 * only deterministic position — the exact role `tutor_instructions` plays for a
 * tutor, and the activity frame / `instructions` play for quiz / writing / coding).
 * May throw if a template references a missing variable.
 *
 * `trailingInstructions` is optional so a consumer can assemble a fragment-only
 * PREAMBLE (quiz / writing / coding) and concatenate its own frame afterwards. An
 * empty plan with no trailing text renders to the empty string (so an activity that
 * declares no fragments gets no stray whitespace); every non-empty result ends in a
 * single trailing newline, byte-identical to the historic tutor output.
 */
export function assembleSystemPrompt(
  plan: ResolvedFragment[],
  trailingInstructions?: string,
): string {
  const parts = plan.map((fragment) => {
    const template = Handlebars.compile(fragment.content, COMPILE_OPTIONS);
    return template(fragment.variables).trimEnd();
  });
  if (trailingInstructions !== undefined) parts.push(trailingInstructions.trimEnd());
  if (parts.length === 0) return "";
  return `${parts.join("\n\n")}\n`;
}
