import { RequestContext } from "@mastra/core/request-context";
import { ConversationStats } from "@/app/codes/[code]/conversation-stats";
import {
  TUTOR_MODEL_OVERRIDE,
  TUTOR_PROVIDER_OVERRIDE,
  TUTOR_REASONING_OVERRIDE,
  TUTOR_URL,
} from "@/app/mastra/tutor-agent";
import type { CodeModuleDef } from "./registry";

// The tutor module: a chat tutor whose system prompt + model come from the tutor
// YAML at the code's `file_url`. The tutor agent loads/builds the prompt itself
// per request (RequestContext just carries the URL — plus the code's LLM
// override pair when set, which the agent applies over the YAML's llm values),
// so buildRequestContext never fails here. The teacher detail is the shared
// conversation stats — for a tutor the chats are the point of its review.

export const tutorModule: CodeModuleDef = {
  fileKind: "tutor",
  runtime: {
    agentId: "tutor",
    async buildRequestContext(entry) {
      const context = new RequestContext();
      context.set(TUTOR_URL, entry.fileUrl);
      if (entry.llm) {
        context.set(TUTOR_PROVIDER_OVERRIDE, entry.llm.provider);
        context.set(TUTOR_MODEL_OVERRIDE, entry.llm.model);
        // Only when the override carries one — an absent key lets the agent
        // pin no reasoning effort at all (the wholesale rule, see the agent).
        if (entry.llm.reasoning) context.set(TUTOR_REASONING_OVERRIDE, entry.llm.reasoning);
      }
      return { ok: true, context };
    },
  },
  renderDetail: (entry) => ConversationStats({ entry }),
  // renderResult omitted — defaults to the share link (see `renderCodeResult`).
};
