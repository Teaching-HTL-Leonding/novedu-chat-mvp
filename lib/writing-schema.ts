// Zod schema for the writing YAML document — the strict AUTHORING gate, the writing
// counterpart to `lib/tutors/schemas.ts`. Every object uses `z.strictObject` so a
// typo (`instuctions:`, `anonymouss:`) surfaces as a schema error instead of being
// silently dropped. This describes the YAML DOCUMENT shape (nested `llm.model`),
// distinct from the flattened `Writing` runtime interface in `lib/writing-yaml.ts`
// — they are kept in sync by hand.
//
// Authoring stays deliberately STRICTER than the lenient runtime `parseWriting`:
// nothing is coerced. The runtime parser exists so a student never hits a hard
// crash; this gate exists so a teacher never SAVES a structurally broken activity.

import { z } from "zod";
import { providerSchema } from "@/lib/llm/provider";
import { FragmentFileRefSchema, FragmentRefSchema } from "@/lib/prompt-fragments";

export const WritingYamlSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().optional(),
  // Student-facing welcome screen (both optional).
  title: z.string().optional(),
  description: z.string().optional(),
  // Privacy: writing DIVERGES — it defaults `anonymous: false` (attributed), since
  // review and the Save feature need to know whose text it is. `anonymous: true`
  // makes the activity ephemeral and disables saving.
  anonymous: z.boolean().optional(),
  // `provider` selects which LLM endpoint serves `model` (default SCCH).
  llm: z.strictObject({ model: z.string().min(1), provider: providerSchema }),
  // Optional document-level prompt-fragment block (the tutor `prompt` shape flattened
  // to the root). The assembled fragments are prepended to `instructions` at load
  // (see `lib/writing-fetch.ts`) — fragments first, `instructions` last.
  fragment_files: z.array(FragmentFileRefSchema).default([]),
  fragments: z.array(FragmentRefSchema).default([]),
  // The writing coach's system prompt. SERVER-ONLY; required.
  instructions: z.string().min(1),
  // Optional starter text prefilled into the editor.
  placeholder: z.string().optional(),
});
export type WritingYaml = z.infer<typeof WritingYamlSchema>;
