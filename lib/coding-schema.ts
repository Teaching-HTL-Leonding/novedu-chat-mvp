// Zod schema for the coding YAML document — the strict AUTHORING gate, the coding
// counterpart to `lib/quiz-schema.ts` / `lib/writing-schema.ts`. Every object uses
// `z.strictObject` so a typo (`instuctions:`, `modle:`) surfaces as a schema error
// instead of being silently dropped. This describes the YAML DOCUMENT shape (nested
// `llm.model`), distinct from the flattened `Coding` runtime interface in
// `lib/coding-yaml.ts` — they are kept in sync by hand.
//
// A coding activity is ALWAYS anonymous (the OpenAI-compatible API path carries no
// per-student identity), so — unlike tutor/quiz/writing — there is NO `anonymous`
// field: the strict object rejects it. There is likewise no student welcome-screen
// `description` and no editor `placeholder` (those are for other modules).
//
// Teacher-facing prose lives in inline `.meta({ description })`; the generator
// (`lib/schema-gen`) emits it into `activities/coding/coding-yaml.schema.json`.
// The reused `llm` sub-schema carries `.meta({ id })` so it becomes a named `$def`.

import { z } from "zod";
import { providerSchema, reasoningLevelSchema } from "@/lib/llm/provider";
import { FragmentFileRefSchema, TextFileRefSchema } from "@/lib/prompt-fragments";

export const CodingYamlSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .meta({ description: "Short machine-readable activity id, e.g. beginner-typescript." }),
  name: z
    .string()
    .optional()
    .meta({ description: "Optional human-readable label (not shown to the student)." }),
  // Student-facing label shown on the /<code> connection page (optional).
  title: z
    .string()
    .optional()
    .meta({ description: "Optional label shown to the student on the /<code> connection page." }),
  // The pinned model that answers. SERVER-ONLY — the proxy pins it and ignores
  // whatever model the coding agent sends; required. `provider` selects which LLM
  // endpoint serves it (default SCCH), and `reasoning` optionally pins a reasoning
  // model's effort level (absent ⇒ the parameter is not sent).
  llm: z
    .strictObject({
      model: z.string().min(1).meta({
        description:
          "The model that answers. SERVER-ONLY and PINNED: the proxy always uses this model and ignores whatever model the coding agent sends.",
      }),
      provider: providerSchema,
      reasoning: reasoningLevelSchema,
    })
    .meta({ id: "llm", description: "The pinned model and provider that answer coding requests." }),
  // Optional document-level prompt-fragment libraries (the tutor `prompt` shape
  // flattened to the root, identical to writing). WHICH fragments are used is expressed
  // by inline `{{fragment "alias.id" …}}` markers inside `instructions` below, rendered
  // as the host template in `loadCoding` (never in `endpoint.ts`).
  fragment_files: z.array(FragmentFileRefSchema).default([]).meta({
    description: "Optional fragment libraries this activity pulls shared prompt fragments from.",
  }),
  // Optional plain-text files (e.g. a sample-solution source file) embedded verbatim into
  // `instructions` via inline `{{file "alias"}}` markers (the tutor `prompt.text_files`
  // shape at the root).
  text_files: z.array(TextFileRefSchema).default([]).meta({
    description:
      'Optional plain-text files (markdown / source, e.g. a sample solution) embedded verbatim into instructions via {{file "alias"}} markers.',
  }),
  // The teacher's system prompt, appended after the coding tool's own. SERVER-ONLY;
  // required.
  instructions: z.string().min(1).meta({
    description:
      'The assistant\'s system prompt. SERVER-ONLY: never sent to the browser or the coding agent, and appended AFTER the coding tool\'s own prompt (so the teacher has the final word). Constrain the assistant to what your class has learned. When any fragment_files or text_files are declared it is a Handlebars template: place fragments inline with {{fragment "alias.id" …}} and embed text files with {{file "alias"}} (optionally {{file "alias" from=10 to=40}} for a line range; escape a literal {{ as \\{{).',
  }),
});
export type CodingYaml = z.infer<typeof CodingYamlSchema>;
