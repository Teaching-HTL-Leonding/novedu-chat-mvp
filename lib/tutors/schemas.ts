// Zod 4 schemas for the tutor-definition format. The reusable prompt-fragment
// schemas (fragment files + the `fragment_files:` / `fragments:` reference shapes)
// live in `@/lib/prompt-fragments` and are composed into the tutor's `prompt` block
// here; this file adds only the tutor-specific surface (identity, llm, example
// questions, tutor_instructions).
//
// Every object uses `z.strictObject` so typos in the source YAML (e.g. `prioirty:`
// or `variabels:`) surface as schema errors instead of silently dropping data.
//
// Teacher-facing prose lives in inline `.meta({ description })`; the generator
// (`lib/schema-gen`) emits it into `activities/tutors/tutor-yaml.schema.json`.
// Reused sub-schemas carry `.meta({ id })` so the generator emits named `$defs`.
// Optional booleans carry `.meta({ default })` — an editor hint of the runtime
// default (applied in the module logic, NOT here) that does not change parsing.

import { z } from "zod";
import { providerSchema } from "@/lib/llm/provider";
import { FragmentFileRefSchema, FragmentRefSchema } from "@/lib/prompt-fragments";

/**
 * An example question offered to students on the welcome screen: the `title` is
 * the clickable label, the `question` is the full text placed into the chat
 * input on click. Tutors may define any number; the UI samples at most 5.
 */
export const ExampleQuestionSchema = z
  .strictObject({
    title: z
      .string()
      .min(1)
      .meta({ description: "Short clickable label shown on the welcome screen." }),
    question: z.string().min(1).meta({
      description:
        "Full question text. Shown as a tooltip and placed into the chat input on click.",
    }),
  })
  .meta({ id: "exampleQuestion", description: "An example question shown on the welcome screen." });
export type ExampleQuestion = z.infer<typeof ExampleQuestionSchema>;

export const TutorSchema = z.strictObject({
  id: z.string().meta({ description: "Short machine-readable tutor id, e.g. fractions-de." }),
  name: z.string().meta({ description: "Human-readable tutor title." }),
  // Shown to students on the empty chat's welcome screen: `title` replaces the
  // default greeting, `description` renders below it.
  title: z.string().optional().meta({
    description:
      "Optional greeting shown to students on the empty chat instead of the default welcome message.",
  }),
  description: z.string().meta({
    description:
      "Short description of what this tutor does. Shown to students below the welcome greeting.",
  }),
  exampleQuestions: z.array(ExampleQuestionSchema).optional().meta({
    description:
      "Optional example questions shown to students below the description on the empty chat. Clicking one puts the question text into the chat input. At most 5 are shown; with more, a random 5 are picked per page load.",
  }),
  // Privacy: chats are anonymous by default — no link between the signed-in
  // user and their chat is persisted. A tutor opts INTO attribution with
  // `anonymous: false`, which records who owns each chat in `novedu_user_chats`.
  anonymous: z.boolean().optional().meta({
    default: true,
    description:
      "Chats are anonymous by default: no link between the signed-in student and their chat is stored. Set to false to record which student each chat belongs to.",
  }),
  // Students may attach images in the chat by default; a tutor opts OUT with
  // `imageInput: false` (e.g. for models without vision support — the flag is
  // what gates the upload UI, nothing checks the model's actual modalities).
  // `provider` selects which LLM endpoint serves `model` (default SCCH).
  llm: z
    .strictObject({
      model: z.string().meta({ description: "Model used for this tutor." }),
      provider: providerSchema,
      imageInput: z.boolean().optional().meta({
        default: true,
        description:
          "Image uploads are enabled by default. Set to false to hide the upload UI for text-only tutors or non-vision-capable models.",
      }),
    })
    .meta({ id: "llm", description: "The model and provider that back this tutor." }),
  prompt: z
    .strictObject({
      fragment_files: z
        .array(FragmentFileRefSchema)
        .default([])
        .meta({ description: "Optional fragment libraries used by this tutor." }),
      fragments: z
        .array(FragmentRefSchema)
        .default([])
        .meta({ description: "Optional fragments selected from fragment_files." }),
      tutor_instructions: z.string().meta({
        description:
          "Final tutor-specific system-prompt instructions. For single-file tutors, this can be the whole prompt.",
      }),
    })
    .meta({
      id: "prompt",
      description: "The assembled system prompt: fragments plus tutor instructions.",
    }),
});
export type Tutor = z.infer<typeof TutorSchema>;
