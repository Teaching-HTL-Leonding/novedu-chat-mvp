"use server";

import { randomUUID } from "node:crypto";
import { RequestContext } from "@mastra/core/request-context";
import { after } from "next/server";
import { mastra } from "@/app/mastra";
import {
  QUIZ_EVAL_INSTRUCTIONS,
  QUIZ_EVAL_MODEL,
  QUIZ_EVAL_PROVIDER,
  QUIZ_VERDICT_SCHEMA,
} from "@/app/mastra/quiz-agents";
import { validateAnswerImages } from "@/lib/answer-images";
import { buildQuestionSeed, buildVerdictSeed } from "@/lib/quiz-discussion-prompt";
import { buildAnswerMessage, buildGradingPrompt } from "@/lib/quiz-grading-prompt";
import type { QuizVerdict } from "@/lib/quiz-types";
import { effectiveImageInput, type QuizCodeInput, verifyAndLoadQuestion } from "@/lib/quiz-verify";
import { getThreadTokenSecret, signThreadToken } from "@/lib/thread-token";
import { USAGE_CODE, USAGE_MODULE, USAGE_USER_ID } from "@/lib/usage-context-keys";
import { recordQuizAnswer } from "@/lib/usage-store";

// The student-facing quiz server actions. The whole app sits behind the Entra
// gate, so any caller is authenticated; the quiz CODE (a `novedu_codes` row with
// `module: "quiz"`) is what authorizes the quiz experience, and it is RE-VERIFIED
// on every action (so a code outside its window stops accepting answers / opening
// discussions mid-session). The server-only `evaluation` grading prompts are read
// here and NEVER returned to the client.
//
// Grading goes through the memory-less `quizEvaluator` agent; the discussion is a
// Mastra thread seeded with three messages that the runtime route then continues
// with the `quizDiscussion` agent. resourceId = the CODE throughout (see
// docs/codes.md), exactly like every other module.

// The verification preamble (`verifyAndLoadQuestion`, `QuizCodeInput`,
// `effectiveImageInput`, and the rejection-message map) lives in the non-`"use
// server"` `lib/quiz-verify.ts` — exporting it from THIS file would mint a public
// endpoint returning the loaded quiz's server-only `evaluation` prompts. Do NOT
// re-export even the types from here: Next's `"use server"` transform emits a
// runtime reference for a type-only re-export, which crashes the module at load
// (import `QuizCodeInput` from `@/lib/quiz-verify` instead).

export type SubmitAnswerResult =
  | { ok: true; result: QuizVerdict; feedback: string }
  | { ok: false; message: string };

export type StartDiscussionResult =
  | { ok: true; threadId: string; threadToken: string }
  | { ok: false; message: string };

// The three messages that seed a discussion thread's MEMORY (question / answer /
// verdict+feedback) so the agent recalls full context. Server-internal only —
// the dialog shows just the graded feedback, never these as bubbles, so they are
// no longer handed back to the client. The student-answer seed may carry the
// answer's photos as `file` parts (data URLs), so the discussion agent sees them
// via memory recall and the read-only transcript viewer renders them inline.
interface QuizSeedMessage {
  role: "assistant" | "user";
  text: string;
  images?: string[];
}

// The GRADING prompt (`buildGradingPrompt` + the answer-message wrappers) and the
// DISCUSSION prompt/seed templates live in the pure, CLI-safe `lib/quiz-grading-prompt.ts`
// and `lib/quiz-discussion-prompt.ts`. They are imported — never copied — so
// `@novedu/cli prompts --kind quiz` dumps byte-identical production prompts.

/**
 * Grades one answer — free text, photos (when the question's effective
 * `imageInput` allows them), or both. Re-verifies the quiz code, re-loads the
 * quiz, finds the question, and runs the stateless `quizEvaluator` for a
 * structured verdict. Returns the verdict + markdown feedback; nothing is
 * persisted — the images are discarded after grading.
 */
export async function submitAnswer(
  input: QuizCodeInput & { questionId: string; answer: string; images?: string[] },
): Promise<SubmitAnswerResult> {
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  if (!answer && (input.images === undefined || input.images.length === 0)) {
    return { ok: false, message: "Type an answer or add a photo before submitting." };
  }

  const ctx = await verifyAndLoadQuestion(input);
  if (!ctx.ok) return ctx;

  const checked = validateAnswerImages(input.images, effectiveImageInput(ctx.quiz, ctx.question));
  if (!checked.ok) return checked;
  const images = checked.images;

  const requestContext = new RequestContext();
  requestContext.set(
    QUIZ_EVAL_INSTRUCTIONS,
    buildGradingPrompt(ctx.question, ctx.quiz.instructionsPreamble),
  );
  requestContext.set(QUIZ_EVAL_MODEL, ctx.llm.model);
  requestContext.set(QUIZ_EVAL_PROVIDER, ctx.llm.provider);
  // Attribute the server-only grader's token usage exactly like a runtime-route
  // agent — the observability exporter reads these off its MODEL_GENERATION span.
  requestContext.set(USAGE_CODE, ctx.code);
  requestContext.set(USAGE_USER_ID, ctx.userId);
  requestContext.set(USAGE_MODULE, "quiz");

  // Text-only answers keep the plain-string call; an answer with photos becomes
  // ONE multimodal user message (text part + one image part per photo — the
  // data URL carries its own mime type). Only the message shape changes; the
  // structured-output verdict flow is identical.
  const answerText = buildAnswerMessage(answer);
  const prompt =
    images.length === 0
      ? answerText
      : [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: answerText },
              ...images.map((image) => ({ type: "image" as const, image })),
            ],
          },
        ];

  try {
    const res = await mastra.getAgent("quizEvaluator").generate(prompt, {
      structuredOutput: { schema: QUIZ_VERDICT_SCHEMA },
      requestContext,
    });
    const object = res.object as { result: QuizVerdict; feedback: string } | undefined;
    if (!object) {
      return { ok: false, message: "The answer could not be graded right now. Please try again." };
    }
    // Count the answered question off the response path (the store never throws).
    after(() => recordQuizAnswer({ code: ctx.code, userId: ctx.userId }));
    return { ok: true, result: object.result, feedback: object.feedback };
  } catch (error) {
    console.error("quiz-actions: grading failed", error);
    return { ok: false, message: "The answer could not be graded right now. Please try again." };
  }
}

function safeVerdict(value: unknown): QuizVerdict {
  return value === "correct" || value === "partial" || value === "incorrect" ? value : "partial";
}

/**
 * Opens an opt-in discussion about a graded question. Mints a thread id, signs a
 * thread-ownership token, and seeds a Mastra thread with three messages
 * (question / answer / verdict+feedback) so the discussion agent has full context
 * via memory recall. Returns the thread id + token for the inline chat to mount.
 * resourceId = the quiz CODE (groups a quiz's discussions for stats), and the
 * token binds `(code, userId, threadId)` like every other module.
 */
export async function startDiscussion(
  input: QuizCodeInput & {
    questionId: string;
    answer: string;
    result: QuizVerdict;
    feedback: string;
    images?: string[];
  },
): Promise<StartDiscussionResult> {
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  const feedback = typeof input.feedback === "string" ? input.feedback : "";
  if (!answer && (input.images === undefined || input.images.length === 0)) {
    return { ok: false, message: "There is no answer to discuss yet." };
  }

  const ctx = await verifyAndLoadQuestion(input);
  if (!ctx.ok) return ctx;

  // The same photos the answer was graded with (the trust note below applies);
  // the imageInput gate + size checks still run — a question that does not
  // accept images never gets one persisted into a thread.
  const checked = validateAnswerImages(input.images, effectiveImageInput(ctx.quiz, ctx.question));
  if (!checked.ok) return checked;
  const images = checked.images;

  const threadId = randomUUID();
  const resourceId = ctx.code;
  const threadToken = signThreadToken(
    { code: resourceId, userId: ctx.userId, threadId },
    getThreadTokenSecret(),
  );

  // The three seed messages. The question text is the SERVER's (authoritative);
  // the answer/verdict/feedback are the student's own graded turn — faking them
  // would only mislead the student's own chat, so they are accepted as-is.
  const seeds: QuizSeedMessage[] = [
    { role: "assistant", text: buildQuestionSeed(ctx.question.question.trim()) },
    { role: "user", text: answer, images },
    { role: "assistant", text: buildVerdictSeed(safeVerdict(input.result), feedback) },
  ];

  try {
    const memory = await mastra.getAgent("quizDiscussion").getMemory();
    if (!memory) {
      return { ok: false, message: "The discussion could not be started right now." };
    }
    await memory.createThread({ threadId, resourceId });
    // Distinct, increasing createdAt so the transcript orders by time as well as
    // by insertion (seq_id). The stored content envelope is the v2 UIMessage
    // shape the read-only viewer parses (`lib/conversation-collapse.ts`): text
    // parts plus — for the student-answer seed — one `file` part per photo whose
    // `data` is the data URL, exactly what the tutor's attachments persist.
    const base = Date.now();
    await memory.saveMessages({
      messages: seeds.map((seed, i) => ({
        id: randomUUID(),
        role: seed.role,
        type: "text",
        threadId,
        resourceId,
        createdAt: new Date(base + i),
        content: {
          format: 2 as const,
          parts: [
            ...(seed.text ? [{ type: "text" as const, text: seed.text }] : []),
            ...(seed.images ?? []).map((image) => ({
              type: "file" as const,
              mimeType: image.slice("data:".length, image.indexOf(";")),
              data: image,
            })),
          ],
          content: seed.text,
        },
      })),
    });
    return { ok: true, threadId, threadToken };
  } catch (error) {
    console.error("quiz-actions: starting discussion failed", error);
    return {
      ok: false,
      message: "The discussion could not be started right now. Please try again.",
    };
  }
}
