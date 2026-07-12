// Zod 4 schemas for the tutor-definition format. The reusable prompt-fragment
// schemas (fragment files + the `fragment_files:` / `fragments:` reference shapes)
// live in `@/lib/prompt-fragments` and are composed into the tutor's `prompt` block
// here; this file adds only the tutor-specific surface (identity, llm, example
// questions, tutor_instructions).
//
// Every object uses `z.strictObject` so typos in the source YAML (e.g. `prioirty:`
// or `variabels:`) surface as schema errors instead of silently dropping data.

import { z } from "zod";
import { providerSchema } from "@/lib/llm/provider";
import { FragmentFileRefSchema, FragmentRefSchema } from "@/lib/prompt-fragments";

/**
 * An example question offered to students on the welcome screen: the `title` is
 * the clickable label, the `question` is the full text placed into the chat
 * input on click. Tutors may define any number; the UI samples at most 5.
 */
export const ExampleQuestionSchema = z.strictObject({
  title: z.string().min(1),
  question: z.string().min(1),
});
export type ExampleQuestion = z.infer<typeof ExampleQuestionSchema>;

export const TutorSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  // Shown to students on the empty chat's welcome screen: `title` replaces the
  // default greeting, `description` renders below it.
  title: z.string().optional(),
  description: z.string(),
  exampleQuestions: z.array(ExampleQuestionSchema).optional(),
  // Privacy: chats are anonymous by default — no link between the signed-in
  // user and their chat is persisted. A tutor opts INTO attribution with
  // `anonymous: false`, which records who owns each chat in `novedu_user_chats`.
  anonymous: z.boolean().optional(),
  // Students may attach images in the chat by default; a tutor opts OUT with
  // `imageInput: false` (e.g. for models without vision support — the flag is
  // what gates the upload UI, nothing checks the model's actual modalities).
  // `provider` selects which LLM endpoint serves `model` (default SCCH).
  llm: z.strictObject({
    model: z.string(),
    provider: providerSchema,
    imageInput: z.boolean().optional(),
  }),
  prompt: z.strictObject({
    fragment_files: z.array(FragmentFileRefSchema).default([]),
    fragments: z.array(FragmentRefSchema).default([]),
    tutor_instructions: z.string(),
  }),
});
export type Tutor = z.infer<typeof TutorSchema>;
