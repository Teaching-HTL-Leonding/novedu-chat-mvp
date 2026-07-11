import { parse as parseYamlText } from "yaml";
import type { ImageRef } from "./image-ref";
import { DEFAULT_PROVIDER, type LlmProvider, parseLenientProvider } from "./llm/provider";
import type { QuizPublic, QuizQuestionPublic } from "./quiz-types";

// LENIENT runtime parse of a quiz YAML — the STUDENT path. Quizzes are stored in
// `novedu_files` under `kind: "quiz"`. This is a small typed read that checks just
// the essentials needed to run and grade the quiz, with a friendly message when
// something required is missing, so a student never hits a hard crash. It is NOT
// the authoring gate: the strict schema/Zod validator that blocks a bad SAVE lives
// in `lib/quiz-validate.ts` (`QuizYamlSchema`) and is deliberately separate and
// stricter than this read.
//
// SERVER-SIDE: parses YAML and exposes the server-only `evaluation` prompts.
// The student page must call `toPublicQuiz` before sending anything to the
// browser, so the grading prompts never cross the wire.

/** One question, INCLUDING its server-only grading prompt. */
export interface QuizQuestion {
  id: string;
  title?: string;
  /** Markdown shown to the student. */
  question: string;
  /** SERVER-ONLY grading prompt — embeds the expected answer + criteria. */
  evaluation: string;
  /** Optional content image — carries no secret, so it survives into the public projection. */
  image?: ImageRef;
  /** Per-question override of the quiz-level `imageInput` (unset ⇒ inherit). */
  imageInput?: boolean;
}

/** A fully parsed quiz. `evaluation` prompts and `model` are server-side only. */
export interface Quiz {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  /** Privacy flag, read LIVE from the YAML. Default `true` (anonymous). */
  anonymous: boolean;
  /** Random question order per attempt. Default `true`. */
  shuffle: boolean;
  /** The model id that grades answers AND drives the discussion chat. */
  model: string;
  /** The LLM provider serving `model` (`llm.provider`, default SCCH). */
  provider: LlmProvider;
  /**
   * Quiz-level default for photo answers (`llm.imageInput`, default `false` —
   * the model must be vision-capable). Per-question `imageInput` overrides it.
   */
  imageInput: boolean;
  /** Optional guidance appended to the discussion chat's system prompt. */
  discussionInstructions?: string;
  questions: QuizQuestion[];
}

export type QuizParseResult = { ok: true; quiz: Quiz } | { ok: false; message: string };

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() !== "" ? value : undefined;
  // YAML types unquoted scalars by value, so `id: 1` arrives as a number and
  // `id: true` as a boolean. Coerce a finite number / boolean to its string form
  // rather than silently dropping the field — a teacher writing the natural
  // `- id: 1` must not lose the whole question (nor a numeric title/name vanish).
  // NaN/Infinity stay rejected: they make no sense as an id and `String()` them
  // would only produce a confusing "NaN"/"Infinity" value.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// LENIENT read of an optional content image. Only a non-null object with a
// trimmed non-empty string `src` yields a ref; anything malformed is dropped so
// the question still renders without an image. `hosted` defaults to `false`;
// `alt` and `credit` (the attribution shown below the image) are carried through
// only when each is a trimmed non-empty string.
function asImageRef(value: unknown): ImageRef | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const src = asString(obj.src);
  if (!src) return undefined;
  const alt = asString(obj.alt);
  const credit = asString(obj.credit);
  return {
    hosted: asBool(obj.hosted, false),
    src,
    ...(alt ? { alt } : {}),
    ...(credit ? { credit } : {}),
  };
}

/**
 * Parses and lightly validates a quiz YAML. Returns a friendly error message
 * (not structured errors) when an essential field is missing — the student page
 * shows it as a notice. `anonymous` and `shuffle` default to `true`.
 */
export function parseQuiz(content: string): QuizParseResult {
  let doc: unknown;
  try {
    doc = parseYamlText(content);
  } catch {
    return { ok: false, message: "This quiz could not be read — its YAML is not valid." };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, message: "This quiz is empty or malformed." };
  }
  const root = doc as Record<string, unknown>;

  const llm = root.llm as Record<string, unknown> | undefined;
  const model = asString(llm?.model);
  if (!model) {
    return { ok: false, message: "This quiz does not specify a model (llm.model)." };
  }

  // Missing ⇒ SCCH; present-but-invalid is rejected so a Foundry-intended quiz
  // never silently runs against SCCH.
  const provider =
    llm?.provider === undefined ? DEFAULT_PROVIDER : parseLenientProvider(llm.provider);
  if (!provider) {
    return {
      ok: false,
      message: 'This quiz uses an unsupported llm.provider (use "SCCH" or "Azure Foundry").',
    };
  }

  const rawQuestions = root.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return { ok: false, message: "This quiz has no questions." };
  }

  const questions: QuizQuestion[] = [];
  const seenIds = new Set<string>();
  for (const raw of rawQuestions) {
    if (typeof raw !== "object" || raw === null) continue;
    const q = raw as Record<string, unknown>;
    const id = asString(q.id);
    const question = asString(q.question);
    const evaluation = asString(q.evaluation);
    // A question is usable only with a stable id, a prompt to show, and a
    // grading prompt — skip anything missing one rather than failing the quiz.
    if (!id || !question || !evaluation || seenIds.has(id)) continue;
    seenIds.add(id);
    questions.push({
      id,
      title: asString(q.title),
      question,
      evaluation,
      image: asImageRef(q.image),
      // Only a literal boolean overrides; anything malformed inherits the
      // quiz-level flag rather than failing the quiz.
      ...(typeof q.imageInput === "boolean" ? { imageInput: q.imageInput } : {}),
    });
  }
  if (questions.length === 0) {
    return {
      ok: false,
      message: "This quiz has no complete questions (each needs an id, question and evaluation).",
    };
  }

  return {
    ok: true,
    quiz: {
      id: asString(root.id) ?? asString(root.name) ?? "quiz",
      name: asString(root.name),
      title: asString(root.title),
      description: asString(root.description),
      anonymous: asBool(root.anonymous, true),
      shuffle: asBool(root.shuffle, true),
      model,
      provider,
      imageInput: asBool(llm?.imageInput, false),
      discussionInstructions: asString(
        (root.discussion as Record<string, unknown> | undefined)?.instructions,
      ),
      questions,
    },
  };
}

/**
 * The student-facing projection — strips every server-only field, above all the
 * `evaluation` grading prompts, before anything reaches the browser.
 */
export function toPublicQuiz(quiz: Quiz): QuizPublic {
  const questions: QuizQuestionPublic[] = quiz.questions.map((q) => ({
    id: q.id,
    title: q.title,
    question: q.question,
    // The image carries no secret (unlike `evaluation`) — pass it through unchanged.
    image: q.image,
    // Resolve the two-level flag here so the client sees ONE effective boolean
    // per question (the server actions re-derive it — the client is never trusted).
    imageInput: q.imageInput ?? quiz.imageInput,
  }));
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    shuffle: quiz.shuffle,
    questions,
  };
}
