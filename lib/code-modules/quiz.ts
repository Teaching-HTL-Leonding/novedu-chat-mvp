import { RequestContext } from "@mastra/core/request-context";
import { ConversationStats } from "@/app/codes/[code]/conversation-stats";
import {
  QUIZ_DISCUSSION_INSTRUCTIONS,
  QUIZ_DISCUSSION_MODEL,
  QUIZ_DISCUSSION_PROVIDER,
} from "@/app/mastra/quiz-agents";
import { effectiveLlm } from "@/lib/code-store";
import { providerUnavailableReason } from "@/lib/llm/availability";
import { loadQuiz } from "@/lib/quiz-fetch";
import type { Quiz } from "@/lib/quiz-yaml";
import type { CodeModuleDef } from "./registry";

// The quiz module: the per-question discussion chat (the grader runs only inside
// submitAnswer, never through the runtime route). The discussion agent's system
// prompt is the quiz-level `instructionsPreamble` (the rendered `instructions` host
// text — shared safety/persona/language rules, the SAME preamble the grader receives)
// followed by a default frame and the quiz's optional `discussionInstructions`; the
// question/answer/verdict are the thread's seed messages, recalled from memory, NOT
// repeated here. The teacher detail is the shared conversation stats ("Discussions").
function buildDiscussionInstructions(quiz: Quiz): string {
  const base =
    "You are helping a student understand a single quiz question. The conversation " +
    "already contains the question, the student's submitted answer, and the verdict " +
    "with feedback — use that context. Be concise and encouraging, and stay on this " +
    "question.";
  const frame = quiz.discussionInstructions
    ? `${base}\n\n${quiz.discussionInstructions.trim()}`
    : base;
  // Prepend the quiz preamble ahead of the frame (empty preamble ⇒ frame as-is).
  return quiz.instructionsPreamble ? `${quiz.instructionsPreamble}\n\n${frame}` : frame;
}

export const quizModule: CodeModuleDef = {
  fileKind: "quiz",
  runtime: {
    agentId: "quizDiscussion",
    async buildRequestContext(entry) {
      // The quiz YAML supplies the discussion system prompt + provider/model
      // (re-loaded server-side, never trusted from the client); the code's LLM
      // override pair, when set, replaces the YAML's llm values.
      const loaded = await loadQuiz(entry.fileUrl);
      if (!loaded.ok) return { ok: false, status: 502, message: loaded.message };
      const llm = effectiveLlm(entry, loaded.quiz);
      // The authoring gate blocks saving such a file, but externally hosted YAML
      // (or an env change) can still name a provider this server cannot serve.
      const unavailable = providerUnavailableReason(llm.provider);
      if (unavailable) return { ok: false, status: 502, message: unavailable };
      const context = new RequestContext();
      context.set(QUIZ_DISCUSSION_INSTRUCTIONS, buildDiscussionInstructions(loaded.quiz));
      context.set(QUIZ_DISCUSSION_MODEL, llm.model);
      context.set(QUIZ_DISCUSSION_PROVIDER, llm.provider);
      return { ok: true, context };
    },
  },
  renderDetail: (entry) => ConversationStats({ entry }),
  // renderResult omitted — defaults to the share link (see `renderCodeResult`).
};
