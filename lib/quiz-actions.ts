"use server";

import { randomUUID } from "node:crypto";
import { RequestContext } from "@mastra/core/request-context";
import { mastra } from "@/app/mastra";
import {
  QUIZ_EVAL_INSTRUCTIONS,
  QUIZ_EVAL_MODEL,
  QUIZ_VERDICT_SCHEMA,
} from "@/app/mastra/quiz-agents";
import { auth } from "@/auth";
import { loadQuiz } from "@/lib/quiz-fetch";
import { getQuizLinkSecret, quizLinkRejectionMessage, verifyQuizLink } from "@/lib/quiz-link";
import { type QuizVerdict, verdictLabel } from "@/lib/quiz-types";
import type { Quiz, QuizQuestion } from "@/lib/quiz-yaml";
import { getThreadTokenSecret, signThreadToken } from "@/lib/thread-token";

// The student-facing quiz server actions. The whole app sits behind the Entra
// gate, so any caller is authenticated; the SIGNED LINK is what authorizes the
// quiz experience, and it is RE-VERIFIED on every action (so an expired link
// stops accepting answers / opening discussions mid-session). The server-only
// `evaluation` grading prompts are read here and NEVER returned to the client.
//
// Grading goes through the memory-less `quizEvaluator` agent; the discussion is
// a Mastra thread seeded with three messages that the runtime route's quiz
// branch then continues with the `quizDiscussion` agent. resourceId = the
// normalized quiz URL throughout (see docs/quizzes.md).

export interface QuizLinkInput {
  quiz: string;
  start: string;
  end: string;
  sig: string;
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
// no longer handed back to the client.
interface QuizSeedMessage {
  role: "assistant" | "user";
  text: string;
}

type LoadedQuestion = {
  ok: true;
  userId: string;
  quizUrl: string;
  quiz: Quiz;
  question: QuizQuestion;
};

// Shared preamble for both actions: authenticated session + valid, in-window
// link + the (server-authoritative) quiz question by id. Returns a ready-to-show
// message on any failure.
async function verifyAndLoadQuestion(
  input: QuizLinkInput & { questionId: string },
): Promise<LoadedQuestion | { ok: false; message: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, message: "Please sign in to continue." };

  const link = verifyQuizLink(input, getQuizLinkSecret(), Math.floor(Date.now() / 1000));
  if (!link.ok) return { ok: false, message: quizLinkRejectionMessage(link.reason) };

  const loaded = await loadQuiz(link.quiz);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const question = loaded.quiz.questions.find((q) => q.id === input.questionId);
  if (!question) return { ok: false, message: "That question is no longer part of this quiz." };

  return { ok: true, userId, quizUrl: link.quiz, quiz: loaded.quiz, question };
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
 * Grades one free-text answer. Re-verifies the link, re-loads the quiz, finds the
 * question, and runs the stateless `quizEvaluator` for a structured verdict.
 * Returns the verdict + markdown feedback; nothing is persisted.
 */
export async function submitAnswer(
  input: QuizLinkInput & { questionId: string; answer: string },
): Promise<SubmitAnswerResult> {
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  if (!answer) return { ok: false, message: "Type an answer before submitting." };

  const ctx = await verifyAndLoadQuestion(input);
  if (!ctx.ok) return ctx;

  const requestContext = new RequestContext();
  requestContext.set(QUIZ_EVAL_INSTRUCTIONS, buildGradingPrompt(ctx.question));
  requestContext.set(QUIZ_EVAL_MODEL, ctx.quiz.model);

  try {
    const res = await mastra
      .getAgent("quizEvaluator")
      .generate(`The student's answer:\n\n${answer}`, {
        structuredOutput: { schema: QUIZ_VERDICT_SCHEMA },
        requestContext,
      });
    const object = res.object as { result: QuizVerdict; feedback: string } | undefined;
    if (!object) {
      return { ok: false, message: "The answer could not be graded right now. Please try again." };
    }
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
 * resourceId = the normalized quiz URL (groups a quiz's discussions for stats).
 */
export async function startDiscussion(
  input: QuizLinkInput & {
    questionId: string;
    answer: string;
    result: QuizVerdict;
    feedback: string;
  },
): Promise<StartDiscussionResult> {
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  const feedback = typeof input.feedback === "string" ? input.feedback : "";
  if (!answer) return { ok: false, message: "There is no answer to discuss yet." };

  const ctx = await verifyAndLoadQuestion(input);
  if (!ctx.ok) return ctx;

  const threadId = randomUUID();
  const resourceId = ctx.quizUrl;
  const threadToken = signThreadToken(
    { code: resourceId, userId: ctx.userId, threadId },
    getThreadTokenSecret(),
  );

  // The three seed messages. The question text is the SERVER's (authoritative);
  // the answer/verdict/feedback are the student's own graded turn — faking them
  // would only mislead the student's own chat, so they are accepted as-is.
  const seeds: QuizSeedMessage[] = [
    { role: "assistant", text: `Answer the following question: ${ctx.question.question.trim()}` },
    { role: "user", text: answer },
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
    // shape the read-only viewer parses (`lib/conversation-collapse.ts`).
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
          parts: [{ type: "text" as const, text: seed.text }],
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
