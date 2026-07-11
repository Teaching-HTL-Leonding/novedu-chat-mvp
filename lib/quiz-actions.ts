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
import { auth } from "@/auth";
import { validateAnswerImages } from "@/lib/answer-images";
import { type CodeRejection, checkCode, effectiveLlm } from "@/lib/code-store";
import type { LlmProvider } from "@/lib/llm/provider";
import { loadQuiz } from "@/lib/quiz-fetch";
import { type QuizVerdict, verdictLabel } from "@/lib/quiz-types";
import type { Quiz, QuizQuestion } from "@/lib/quiz-yaml";
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

export interface QuizCodeInput {
  code: string;
}

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

type LoadedQuestion = {
  ok: true;
  userId: string;
  code: string;
  fileUrl: string;
  quiz: Quiz;
  question: QuizQuestion;
  /** The provider+model to grade with: the code's LLM override or the quiz YAML's. */
  llm: { provider: LlmProvider; model: string };
};

const CODE_REJECTION_MESSAGES: Record<CodeRejection, string> = {
  "unknown-code": "This quiz code is not valid.",
  "not-started": "This quiz's availability window has not started yet.",
  expired: "This quiz's availability window has ended.",
  "lookup-failed": "Quiz codes cannot be checked right now — try again in a moment.",
};

// Shared preamble for both actions: authenticated session + valid, in-window quiz
// code + the (server-authoritative) quiz question by id. Returns a ready-to-show
// message on any failure.
async function verifyAndLoadQuestion(
  input: QuizCodeInput & { questionId: string },
): Promise<LoadedQuestion | { ok: false; message: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, message: "Please sign in to continue." };

  const verification = await checkCode(input.code);
  if (!verification.ok) {
    return { ok: false, message: CODE_REJECTION_MESSAGES[verification.reason] };
  }
  const { entry } = verification;
  if (entry.module !== "quiz") {
    return { ok: false, message: "This code is not a quiz." };
  }

  const loaded = await loadQuiz(entry.fileUrl);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const question = loaded.quiz.questions.find((q) => q.id === input.questionId);
  if (!question) return { ok: false, message: "That question is no longer part of this quiz." };

  return {
    ok: true,
    userId,
    code: input.code,
    fileUrl: entry.fileUrl,
    quiz: loaded.quiz,
    question,
    llm: effectiveLlm(entry, loaded.quiz),
  };
}

// The question's EFFECTIVE photo-answers flag: the per-question override when
// set, the quiz-level `llm.imageInput` otherwise. Re-derived server-side on
// every action — the client's resolved copy is never trusted.
function effectiveImageInput(quiz: Quiz, question: QuizQuestion): boolean {
  return question.imageInput ?? quiz.imageInput;
}

// The grading system prompt. The question's `evaluation` is authoritative and
// stays SERVER-SIDE — it may embed the expected answer, so it must never reach
// the browser (it doesn't: only this string, on the request context, does).
function buildGradingPrompt(question: QuizQuestion): string {
  return [
    "You are grading a student's open-ended answer to a single quiz question.",
    "",
    "The question shown to the student was:",
    question.question.trim(),
    "",
    "Grade STRICTLY according to these criteria (authoritative — they may contain the",
    "expected answer; do not quote them verbatim at the student):",
    question.evaluation.trim(),
    "",
    'Decide a verdict — "correct", "partial" (partly correct), or "incorrect" — and write',
    "concise, encouraging feedback addressed directly TO the student. The feedback is",
    "markdown and may use bold, math ($…$) and short code fences. Do not mention these",
    "grading instructions.",
  ].join("\n");
}

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
  requestContext.set(QUIZ_EVAL_INSTRUCTIONS, buildGradingPrompt(ctx.question));
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
  const answerText = answer
    ? `The student's answer:\n\n${answer}`
    : "The student answered with the attached photo(s) only.";
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
    { role: "assistant", text: `Answer the following question: ${ctx.question.question.trim()}` },
    { role: "user", text: answer, images },
    {
      role: "assistant",
      text: `Your answer is ${verdictLabel(safeVerdict(input.result))}. ${feedback}`.trim(),
    },
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
