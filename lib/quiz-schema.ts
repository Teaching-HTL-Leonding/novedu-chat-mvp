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
//
// Teacher-facing prose lives in inline `.meta({ description })`; the generator
// (`lib/schema-gen`) emits it into `activities/quizzes/quiz-yaml.schema.json`.
// Reused sub-schemas carry `.meta({ id })` so the generator emits named `$defs`.

import { z } from "zod";
import { providerSchema } from "@/lib/llm/provider";
import { FragmentFileRefSchema } from "@/lib/prompt-fragments";

/** An optional content image attached to a question (carries no secret). */
const ImageRefSchema = z
  .strictObject({
    hosted: z.boolean().optional().meta({
      default: false,
      description:
        "When true, src is an app-hosted image NAME resolved server-side; otherwise src is an absolute URL or a path relative to the quiz's own URL.",
    }),
    src: z.string().min(1).meta({
      description: "The hosted image name (when hosted) or the image URL / relative path.",
    }),
    alt: z
      .string()
      .optional()
      .meta({ description: "Accessible description shown if the image cannot be loaded." }),
    credit: z.string().optional().meta({
      description: 'Optional attribution ("Content Credentials") shown small below the image.',
    }),
  })
  .meta({ id: "image", description: "An optional content image attached to a question." });

/**
 * One question. `id` keys the per-question stats (must be unique — see
 * `lib/quiz-validate.ts`); `question` is the Markdown shown to the student;
 * `evaluation` is the server-only grading prompt.
 */
const QuizQuestionSchema = z
  .strictObject({
    id: z.string().min(1).meta({
      description: "Stable question id, unique within the quiz (the per-question stats key).",
    }),
    title: z
      .string()
      .optional()
      .meta({ description: "Optional short label for the stats table and progress display." }),
    question: z.string().min(1).meta({ description: "The Markdown shown to the student." }),
    evaluation: z.string().min(1).meta({
      description:
        "The grading prompt. SERVER-ONLY: never sent to the browser, so it may embed the expected answer and the grading rubric.",
    }),
    image: ImageRefSchema.optional(),
    // Overrides the quiz-level `llm.imageInput` for this question only.
    imageInput: z.boolean().optional().meta({
      description:
        "Overrides the quiz-level llm.imageInput for this question only (photo answers on/off).",
    }),
  })
  .meta({ id: "question", description: "One open-ended, LLM-graded quiz question." });

export const QuizYamlSchema = z.strictObject({
  id: z.string().min(1).meta({
    description:
      "Short machine-readable quiz id, e.g. countries-basics. Used as the per-quiz identity.",
  }),
  name: z
    .string()
    .optional()
    .meta({ description: "Optional human-readable quiz title (used as a label)." }),
  // Student-facing welcome screen (both optional).
  title: z.string().optional().meta({
    description:
      "Optional greeting shown to students on the welcome screen instead of the default message.",
  }),
  description: z.string().optional().meta({
    description: "Optional description shown to students below the welcome greeting (Markdown).",
  }),
  // Privacy: quizzes default `anonymous: true` (answers recorded for aggregate
  // stats but not linked to a student). `anonymous: false` attributes each attempt.
  anonymous: z.boolean().optional().meta({
    default: true,
    description:
      "Quizzes are anonymous by default: answers are recorded for aggregate stats but not linked to a student. Set to false to attribute each attempt to the signed-in student.",
  }),
  // Random question order per attempt, default true.
  shuffle: z.boolean().optional().meta({
    default: true,
    description:
      "Present questions in a random order per attempt. Set to false to keep the authored order.",
  }),
  // `provider` selects which LLM endpoint serves `model` (default SCCH); the one
  // model grades answers AND drives the discussion chat. `imageInput` (default
  // false) lets students attach photos to their answers — the model must be
  // vision-capable; a per-question `imageInput` overrides it.
  llm: z
    .strictObject({
      model: z.string().min(1).meta({
        description: "The model that grades answers and drives the per-question discussion chat.",
      }),
      provider: providerSchema,
      imageInput: z.boolean().optional().meta({
        default: false,
        description:
          "Default for all questions: students may attach photos (up to 3, 5 MB each) to their answers. The model must be vision-capable. A per-question imageInput overrides it.",
      }),
    })
    .meta({
      id: "llm",
      description: "The single model + provider that grades and discusses answers.",
    }),
  // Optional guidance for the per-question follow-up discussion chat.
  discussion: z
    .strictObject({
      instructions: z.string().min(1).meta({
        description:
          "Optional guidance appended to the per-question follow-up discussion chat's system prompt.",
      }),
    })
    .optional()
    .meta({
      id: "discussion",
      description: "Optional guidance for the per-question follow-up discussion chat.",
    }),
  // Optional document-level prompt-fragment libraries (the tutor `prompt` shape
  // flattened to the root). WHICH fragments are used is expressed by inline
  // `{{fragment "alias.id" …}}` markers inside the quiz-level `instructions` host
  // text below; that rendered text is prepended to BOTH the grader prompt and the
  // discussion chat's system prompt (see `lib/quiz-fetch.ts`). Per-question
  // `evaluation` and `discussion.instructions` stay plain strings — no markers there.
  fragment_files: z.array(FragmentFileRefSchema).default([]).meta({
    description: "Optional fragment libraries this quiz pulls shared prompt fragments from.",
  }),
  // The quiz-level host text: a preamble rendered once and prepended to both the
  // grader and the discussion prompts. When any fragment_files are declared it is a
  // Handlebars template carrying the inline `{{fragment}}` markers.
  instructions: z.string().optional().meta({
    description:
      'Optional quiz-level preamble prepended to BOTH the grader prompt and the discussion chat. When any fragment_files are declared, place fragments inline here with {{fragment "alias.id" …}} markers (escape a literal {{ as \\{{).',
  }),
  questions: z.array(QuizQuestionSchema).min(1).meta({
    description:
      "The quiz questions. Each is open-ended and graded by the LLM via its evaluation prompt.",
  }),
});
export type QuizYaml = z.infer<typeof QuizYamlSchema>;
