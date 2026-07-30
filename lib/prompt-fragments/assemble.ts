// Handlebars rendering of ONE fragment's `content` against its resolved variables.
// Pure: no network, no YAML. This is the default Handlebars instance — it carries NO
// `fragment` / `array` helpers (those live only in the isolated host-template
// instance), so a fragment whose content tries to call `{{fragment}}` itself fails
// closed under strict mode. Nesting fragments is out of scope by design.

import Handlebars from "handlebars";
import type { VariableValue } from "./schemas";

// `noEscape`: the output is a markdown/LLM prompt, not HTML — ASCII diagrams
//   (`<-`, `->`), ampersands, and quotes must pass through verbatim.
// `strict`: referencing an undeclared variable throws instead of silently
//   rendering empty. Placement checking already guarantees required inputs, so a
//   throw here is a backstop the caller surfaces as `ASSEMBLY_ERROR`.
// Exported so the standalone fragment check (`fragment.ts`) renders with the EXACT
// same semantics as real assembly — that identity is what makes "valid as a
// standalone fragment" mean "will render inside an activity".
export const COMPILE_OPTIONS = { strict: true, noEscape: true } as const;

/**
 * Compile and render a single fragment's `content` with the merged variables. Shared
 * by the host-template `fragment` helper (real render) so the produced text is
 * byte-identical to what the standalone fragment check exercises. May throw if the
 * template references a variable not in `variables` (strict mode).
 */
export function renderFragmentContent(
  content: string,
  variables: Record<string, VariableValue>,
): string {
  const template = Handlebars.compile(content, COMPILE_OPTIONS);
  return template(variables);
}
