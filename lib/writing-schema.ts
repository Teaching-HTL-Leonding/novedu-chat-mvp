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
//
// Teacher-facing prose lives in inline `.meta({ description })`; the generator
// (`lib/schema-gen`) emits it into `activities/writings/writing-yaml.schema.json`.
// The reused `llm` sub-schema carries `.meta({ id })` so it becomes a named `$def`.

import { z } from "zod";
import { providerSchema } from "@/lib/llm/provider";
import { FragmentFileRefSchema, FragmentRefSchema } from "@/lib/prompt-fragments";

export const WritingYamlSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .meta({ description: "Short machine-readable activity id, e.g. human-animal-short-story." }),
  name: z
    .string()
    .optional()
    .meta({ description: "Optional human-readable title (used as a label)." }),
  // Student-facing welcome screen (both optional).
  title: z.string().optional().meta({
    description:
      "Optional greeting shown to students on the welcome screen instead of the default message.",
  }),
  description: z.string().optional().meta({
    description: "Optional description shown to students below the welcome greeting (Markdown).",
  }),
  // Privacy: writing DIVERGES — it defaults `anonymous: false` (attributed), since
  // review and the Save feature need to know whose text it is. `anonymous: true`
  // makes the activity ephemeral and disables saving.
  anonymous: z.boolean().optional().meta({
    default: false,
    description:
      "Writing DIVERGES: it defaults to false (attributed), because review and the Save feature need to know whose text it is. Set to true for ephemeral, unattributed writing — which also disables saving.",
  }),
  // `provider` selects which LLM endpoint serves `model` (default SCCH).
  llm: z
    .strictObject({
      model: z.string().min(1).meta({ description: "The model that drives the feedback chat." }),
      provider: providerSchema,
    })
    .meta({ id: "llm", description: "The model and provider that back the writing coach." }),
  // Optional document-level prompt-fragment block (the tutor `prompt` shape flattened
  // to the root). The assembled fragments are prepended to `instructions` at load
  // (see `lib/writing-fetch.ts`) — fragments first, `instructions` last.
  fragment_files: z.array(FragmentFileRefSchema).default([]).meta({
    description: "Optional fragment libraries this activity pulls shared prompt fragments from.",
  }),
  fragments: z.array(FragmentRefSchema).default([]).meta({
    description:
      "Optional fragments selected from fragment_files. Assembled in priority order and prepended AHEAD of instructions.",
  }),
  // The writing coach's system prompt. SERVER-ONLY; required.
  instructions: z.string().min(1).meta({
    description:
      "The writing coach's system prompt. SERVER-ONLY: never sent to the browser, so it may describe the assessment criteria and coaching strategy.",
  }),
  // Optional starter text prefilled into the editor.
  placeholder: z.string().optional().meta({
    description: "Optional starter text prefilled into the editor. Empty for a blank page.",
  }),
});
export type WritingYaml = z.infer<typeof WritingYamlSchema>;
