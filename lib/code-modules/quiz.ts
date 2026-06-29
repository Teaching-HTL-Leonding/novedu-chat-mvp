import { RequestContext } from "@mastra/core/request-context";
import { ConversationStats } from "@/app/codes/[code]/conversation-stats";
import { ShareLinkResult } from "@/app/codes/share-link-result";
import { QUIZ_DISCUSSION_INSTRUCTIONS, QUIZ_DISCUSSION_MODEL } from "@/app/mastra/quiz-agents";
import { fileValidators } from "@/lib/file-validators";
import { loadQuiz } from "@/lib/quiz-fetch";
import type { Quiz } from "@/lib/quiz-yaml";
import type { CodeModuleDef } from "./registry";

// The quiz module: the per-question discussion chat (the grader runs only inside
// submitAnswer, never through the runtime route). The discussion agent's system
// prompt is the quiz's optional `discussionInstructions` on top of a default
// frame; the question/answer/verdict are the thread's seed messages, recalled
// from memory, NOT repeated here. The teacher detail is the shared conversation
// stats (labelled "Discussions").
function buildDiscussionInstructions(quiz: Quiz): string {
  const base =
    "You are helping a student understand a single quiz question. The conversation " +
    "already contains the question, the student's submitted answer, and the verdict " +
    "with feedback — use that context. Be concise and encouraging, and stay on this " +
    "question.";
  return quiz.discussionInstructions ? `${base}\n\n${quiz.discussionInstructions.trim()}` : base;
}

export const quizModule: CodeModuleDef = {
  fileKind: "quiz",
  validateOnCreate: (fileUrl, fetcher) => fileValidators.quiz.validate(fileUrl, fetcher),
  runtime: {
    agentId: "quizDiscussion",
    async buildRequestContext(entry) {
      // The quiz YAML supplies the discussion system prompt + model (re-loaded
      // server-side, never trusted from the client).
      const loaded = await loadQuiz(entry.fileUrl);
      if (!loaded.ok) return { ok: false, status: 502, message: loaded.message };
      const context = new RequestContext();
      context.set(QUIZ_DISCUSSION_INSTRUCTIONS, buildDiscussionInstructions(loaded.quiz));
      context.set(QUIZ_DISCUSSION_MODEL, loaded.quiz.model);
      return { ok: true, context };
    },
  },
  renderDetail: (entry) => ConversationStats({ entry }),
  renderResult: (_entry, { shareUrl }) => ShareLinkResult({ shareUrl }),
};
