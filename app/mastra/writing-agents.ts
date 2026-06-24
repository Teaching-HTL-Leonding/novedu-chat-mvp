import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { scchProvider } from "./scch";

// The agent that backs the Writing feature's feedback chat. It is configured
// ENTIRELY per request from values the caller places on the `RequestContext` (the
// activity's model, and the teacher's system prompt) — mirroring how `tutorAgent`
// and the quiz discussion agent resolve their prompt/model per request, but
// without the tutor-YAML coupling. Going through Mastra (rather than calling the
// model SDK directly) keeps it portable to the planned multi-provider model seam.
//
// The agent has NO write/edit tool — it is read-only BY CONSTRUCTION. The only
// tool it can call is the browser-side `getCurrentText` (a frontend tool forwarded
// by @ag-ui/mastra), which returns the student's live editor buffer; there is no
// server-side capability that can mutate the student's text.
//
// SERVER-ONLY: resolves models against the self-hosted endpoint via `scch`.

// RequestContext keys. Distinct from the other agents' keys so a request for one
// can never satisfy another (defense in depth on top of the runtime route's agent
// gating).
export const WRITING_INSTRUCTIONS = "writing-instructions";
export const WRITING_MODEL = "writing-model";

function requiredString(requestContext: RequestContext, key: string): string {
  const value = requestContext.get(key);
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing "${key}" on the request context for the writing agent.`);
  }
  return value;
}

// The feedback chat. Memory-backed exactly like `tutorAgent` and the quiz
// discussion agent (recent-message window, no semantic recall) so a thread
// persists and earlier turns reach the model through the recalled window after
// `trimToNewTurn`. The runtime route sets the system prompt (the activity's
// `instructions`) and model, and scopes memory to `resourceId = the code`.
export const writingAgent = new Agent({
  id: "writing",
  name: "Writing",
  instructions: ({ requestContext }) => requiredString(requestContext, WRITING_INSTRUCTIONS),
  model: ({ requestContext }) => scchProvider.chat(requiredString(requestContext, WRITING_MODEL)),
  memory: new Memory({
    options: {
      lastMessages: 40,
      semanticRecall: false,
    },
  }),
});
