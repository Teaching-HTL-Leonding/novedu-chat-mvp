import { auth } from "@/auth";
import { type CodeRejection, checkCode, effectiveLlm } from "@/lib/code-store";
import type { LlmProvider, ReasoningLevel } from "@/lib/llm/provider";
import { loadQuiz } from "@/lib/quiz-fetch";
import type { Quiz, QuizQuestion } from "@/lib/quiz-yaml";

// The shared quiz-verification preamble — SERVER-ONLY, but deliberately WITHOUT a
// `"use server"` directive. It is imported by the `"use server"` file
// `lib/quiz-actions.ts` (grading) AND, later, by the report action; if this code
// lived in a `"use server"` module, exporting `verifyAndLoadQuestion` would mint a
// public server-action endpoint that returns the loaded `Quiz` — which carries the
// server-only `evaluation` grading prompts (they may embed the expected answer).
// Keeping the helper here, importable by server code only, keeps those prompts off
// the wire. (Touches the database and fetches arbitrary URLs — never client-safe.)

export interface QuizCodeInput {
  code: string;
}

export type LoadedQuestion = {
  ok: true;
  userId: string;
  code: string;
  fileUrl: string;
  quiz: Quiz;
  question: QuizQuestion;
  /**
   * The provider+model (+ optional reasoning effort) to grade with: the code's
   * LLM override or the quiz YAML's.
   */
  llm: { provider: LlmProvider; model: string; reasoning?: ReasoningLevel };
};

export const CODE_REJECTION_MESSAGES: Record<CodeRejection, string> = {
  "unknown-code": "This quiz code is not valid.",
  "not-started": "This quiz's availability window has not started yet.",
  expired: "This quiz's availability window has ended.",
  "lookup-failed": "Quiz codes cannot be checked right now — try again in a moment.",
};

// Shared preamble for both actions: authenticated session + valid, in-window quiz
// code + the (server-authoritative) quiz question by id. Returns a ready-to-show
// message on any failure.
export async function verifyAndLoadQuestion(
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

// The question's EFFECTIVE photo-answers flag now lives in the pure `lib/quiz-yaml.ts`
// (next to `toPublicQuiz`, which resolves the same two-level flag) so the CLI's prompt
// dump can report it without importing this DB-backed module. Re-exported here so the
// server actions keep importing it from their verification preamble — and it is still
// re-derived server-side on every action; the client's resolved copy is never trusted.
export { effectiveImageInput } from "@/lib/quiz-yaml";
