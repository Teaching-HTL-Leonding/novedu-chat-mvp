// Zod schema for the coding YAML document — the strict AUTHORING gate, the coding
// counterpart to `lib/quiz-schema.ts` / `lib/writing-schema.ts`. Every object uses
// `z.strictObject` so a typo (`instuctions:`, `modle:`) surfaces as a schema error
// instead of being silently dropped. This describes the YAML DOCUMENT shape (nested
// `llm.model`), distinct from the flattened `Coding` runtime interface in
// `lib/coding-yaml.ts` — they are kept in sync by hand.
//
// Authoring stays deliberately STRICTER than the lenient runtime `parseCoding`:
// nothing is coerced. The runtime parser exists so a broken activity surfaces a
// friendly notice instead of a crash; this gate exists so a teacher never SAVES a
// structurally broken coding activity.
//
// A coding activity is ALWAYS anonymous (the OpenAI-compatible API path carries no
// per-student identity), so — unlike tutor/quiz/writing — there is NO `anonymous`
// field: the strict object rejects it. There is likewise no student welcome-screen
// `description` and no editor `placeholder` (those are for other modules).

import { z } from "zod";
import { providerSchema } from "@/lib/llm/provider";
import { FragmentFileRefSchema, FragmentRefSchema } from "@/lib/prompt-fragments";

export const CodingYamlSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().optional(),
  // Student-facing label shown on the /<code> connection page (optional).
  title: z.string().optional(),
  // The pinned model that answers. SERVER-ONLY — the proxy pins it and ignores
  // whatever model the coding agent sends; required. `provider` selects which LLM
  // endpoint serves it (default SCCH).
  llm: z.strictObject({ model: z.string().min(1), provider: providerSchema }),
  // Optional document-level prompt-fragment block (the tutor `prompt` shape flattened
  // to the root, identical to writing). The assembled fragments are prepended to
  // `instructions` in `loadCoding` (never in `endpoint.ts`) — fragments first,
  // `instructions` last — and the proxy folds that one finished string into each request.
  fragment_files: z.array(FragmentFileRefSchema).default([]),
  fragments: z.array(FragmentRefSchema).default([]),
  // The teacher's system prompt, appended after the coding tool's own. SERVER-ONLY;
  // required.
  instructions: z.string().min(1),
});
export type CodingYaml = z.infer<typeof CodingYamlSchema>;
