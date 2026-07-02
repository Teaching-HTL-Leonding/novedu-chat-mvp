"use client";

import { ModuleChat } from "@/app/module-chat";
import type { RuntimeHeaders } from "@/lib/runtime-headers";
import { MarkdownRenderer } from "../../markdown-renderer";

// The opt-in per-question discussion chat, mounted in a modal dialog over the
// quiz page. The thread was already minted + seeded server-side by
// `startDiscussion` (question / answer / verdict are persisted as three messages
// the discussion agent recalls for context). CopilotKit's `connect` only replays
// its in-process run cache — empty for a thread seeded directly via memory — so
// the live chat starts visually blank. To give the student context without
// re-printing the whole question + answer, we show just the graded FEEDBACK at the
// top (the verdict card is hidden behind the modal). The student's follow-ups then
// appear in the chat below; nothing is duplicated in the DB because the runtime
// route trims each run to the new turn, and the model still recalls the full
// seeded context from memory.
//
// Provider keyed by threadId: opening a discussion on another question swaps in a
// fresh thread + token (a new discussion per question). Headers carry the quiz
// CODE + the thread-ownership token, both re-verified by the runtime route on
// every request.
export function QuizDiscussion({
  threadId,
  headers,
  feedback,
}: {
  threadId: string;
  headers: RuntimeHeaders;
  feedback: string;
}) {
  // The discussion-body flex wrapper is quiz's own modal layout (feedback + chat
  // sharing a column); ModuleChat is layout-agnostic, so it lives here, not in the
  // primitive. The provider it wraps emits no DOM, so this div stays the surface's
  // root either way.
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="discussion-body">
      <ModuleChat
        agentId="quizDiscussion"
        providerKey={threadId}
        threadId={threadId}
        headers={headers}
        // Deltas only — the fill recipe is ModuleChat's own. The padding keeps
        // the composer off the dialog edges.
        className="px-4 pb-3"
      >
        {feedback ? (
          // The graded feedback, shown once at the top so the student keeps the
          // verdict's reasoning in view while chatting. Capped so long feedback
          // never crowds out the live chat; scrolls within itself if needed.
          <div className="max-h-[35%] overflow-y-auto border-foreground/10 border-b px-4 py-3 text-sm leading-relaxed">
            <MarkdownRenderer content={feedback} />
          </div>
        ) : null}
      </ModuleChat>
    </div>
  );
}
