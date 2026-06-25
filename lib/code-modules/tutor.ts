import { RequestContext } from "@mastra/core/request-context";
import { ConversationStats } from "@/app/codes/[code]/conversation-stats";
import { fileValidators } from "@/lib/file-validators";
import type { CodeModuleDef } from "./registry";

// The tutor module: a chat tutor whose system prompt + model come from the tutor
// YAML at the code's `file_url`. The tutor agent loads/builds the prompt itself
// per request (RequestContext just carries the URL), so buildRequestContext never
// fails here. The teacher detail is the shared conversation stats — for a tutor
// the chats are the point of its review.

export const tutorModule: CodeModuleDef = {
  fileKind: "tutor",
  validateOnCreate: (fileUrl, fetcher) => fileValidators.tutor.validate(fileUrl, fetcher),
  runtime: {
    agentId: "tutor",
    async buildRequestContext(entry) {
      const context = new RequestContext();
      context.set("tutor-url", entry.fileUrl);
      return { ok: true, context };
    },
  },
  renderDetail: (entry) => ConversationStats({ entry }),
};
