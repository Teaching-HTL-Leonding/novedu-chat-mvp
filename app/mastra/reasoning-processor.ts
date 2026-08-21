import type { MastraDBMessage } from "@mastra/core/memory";
import type { OutputProcessor } from "@mastra/core/processors";

// A thinking model's chain of thought is a LIVE, teacher-only artefact
// (docs/chat.md): it is worth watching while the answer forms, and it must never
// become part of the record. This processor is the second half of that rule — the
// route's `ReasoningStrippingRunner` keeps reasoning off a student's wire, and
// this keeps it out of `mastra_messages` for everyone.
//
// WHERE IT SITS: `outputProcessors` run AFTER the response has streamed and
// BEFORE the memory processors persist the message list ("[Your
// outputProcessors] → [Memory Processors]", @mastra/core processors docs). So
// the transform below reaches storage only — a teacher's live stream, which was
// written chunk by chunk while the model was talking, is already gone by the
// time this runs and is not touched. (`processOutputStream` is the hook that
// WOULD alter the live stream; it is deliberately not implemented.)
//
// WHAT FOLLOWS FROM IT: no reload, transcript, export or DB query can surface a
// scratchpad. The read-only viewer already rebuilt each row from its `text` parts
// alone (`lib/conversation-collapse.ts`) — now the parts are not there to begin
// with. The current turn's reasoning still exists in memory while the agentic
// loop runs, which is why the outgoing request body is scrubbed separately
// (`stripAssistantReasoning`, app/mastra/scch.ts).

/** True for a message part carrying reasoning text. */
function isReasoningPart(part: { type?: unknown }): boolean {
  return part?.type === "reasoning";
}

/**
 * The message without its reasoning — both the `reasoning` PARTS and the
 * flattened `content.reasoning` string the v4 UI-message shape carries. Returns
 * the SAME object when there is nothing to drop, so a non-thinking model's turns
 * pass through untouched.
 */
function withoutReasoning(message: MastraDBMessage): MastraDBMessage {
  const parts = message.content.parts;
  const hasReasoningPart = Array.isArray(parts) && parts.some(isReasoningPart);
  if (!hasReasoningPart && message.content.reasoning === undefined) return message;
  const { reasoning: _dropped, ...content } = message.content;
  return {
    ...message,
    content: {
      ...content,
      parts: Array.isArray(parts) ? parts.filter((part) => !isReasoningPart(part)) : parts,
    },
  };
}

/**
 * Drops every reasoning part from the messages an agent is about to persist.
 * Attach to the `outputProcessors` of EVERY agent that has `memory:` configured
 * (tutor, quiz discussion, writing).
 */
export const reasoningStrippingProcessor = {
  id: "strip-reasoning-before-persistence",
  processOutputResult({ messages }) {
    return messages.map(withoutReasoning);
  },
} satisfies OutputProcessor;
