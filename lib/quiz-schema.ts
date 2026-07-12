// Zod schema for the quiz YAML document — the strict AUTHORING gate, the quiz
// counterpart to `lib/tutors/schemas.ts`. Every object uses `z.strictObject` so a
// typo (`anonymouss:`, `evluation:`) surfaces as a schema error instead of being
// silently dropped. This describes the YAML DOCUMENT shape (nested `llm.model`,
// `discussion.instructions`), distinct from the flattened `Quiz` runtime interface
// in `lib/quiz-yaml.ts` — they are kept in sync by hand.
//
// Authoring stays deliberately STRICTER than the lenient runtime `parseQuiz`: ids
// must be strings (quote a numeric-looking id), nothing is coerced. The runtime
// parser exists so a student never hits a hard crash; this gate exists so a teacher
// never SAVES a structurally broken quiz.

import { z } from "zod";
import { providerSchema } from "@/lib/llm/provider";
import { FragmentFileRefSchema, FragmentRefSchema } from "@/lib/prompt-fragments";

/** An optional content image attached to a question (carries no secret). */
const ImageRefSchema = z.strictObject({
  hosted: z.boolean().optional(),
  src: z.string().min(1),
  alt: z.string().optional(),
  credit: z.string().optional(),
});

/**
 * One question. `id` keys the per-question stats (must be unique — see
 * `lib/quiz-validate.ts`); `question` is the Markdown shown to the student;
 * `evaluation` is the server-only grading prompt.
 */
const QuizQuestionSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().optional(),
  question: z.string().min(1),
  evaluation: z.string().min(1),
  image: ImageRefSchema.optional(),
  // Overrides the quiz-level `llm.imageInput` for this question only.
  imageInput: z.boolean().optional(),
});

export const QuizYamlSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().optional(),
  // Student-facing welcome screen (both optional).
  title: z.string().optional(),
  description: z.string().optional(),
  // Privacy: quizzes default `anonymous: true` (answers recorded for aggregate
  // stats but not linked to a student). `anonymous: false` attributes each attempt.
  anonymous: z.boolean().optional(),
  // Random question order per attempt, default true.
  shuffle: z.boolean().optional(),
  // `provider` selects which LLM endpoint serves `model` (default SCCH); the one
  // model grades answers AND drives the discussion chat. `imageInput` (default
  // false) lets students attach photos to their answers — the model must be
  // vision-capable; a per-question `imageInput` overrides it.
  llm: z.strictObject({
    model: z.string().min(1),
    provider: providerSchema,
    imageInput: z.boolean().optional(),
  }),
  // Optional guidance for the per-question follow-up discussion chat.
  discussion: z.strictObject({ instructions: z.string().min(1) }).optional(),
  // Optional document-level prompt-fragment block (the tutor `prompt` shape flattened
  // to the root). The assembled block is prepended to BOTH the grader prompt and the
  // discussion chat's system prompt (see `lib/quiz-fetch.ts`); `evaluation` and
  // `discussion.instructions` stay plain strings.
  fragment_files: z.array(FragmentFileRefSchema).default([]),
  fragments: z.array(FragmentRefSchema).default([]),
  questions: z.array(QuizQuestionSchema).min(1),
});
export type QuizYaml = z.infer<typeof QuizYamlSchema>;
