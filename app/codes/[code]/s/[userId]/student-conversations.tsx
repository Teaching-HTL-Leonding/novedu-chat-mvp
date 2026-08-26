"use client";

import type { Message } from "@ag-ui/core";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { Spinner } from "@/components/spinner";
import { DIALOG_BODY, DialogShell } from "@/components/ui/dialog-shell";
import { loadConversationTranscript } from "@/lib/code-stats-actions";
import type { StudentConversation } from "@/lib/code-stats-store";
import { LocalTime } from "../../../../local-time";
import { ConversationView } from "../../c/[threadId]/conversation-view";

// The student page's conversation list + lightbox. The conversation METADATA is
// server-loaded (passed in); a transcript is fetched only when the teacher opens
// it, via the teacher-gated `loadConversationTranscript` action, and cached so
// reopening does not refetch. The transcript renders read-only through the same
// `ConversationView` the standalone transcript page uses.

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

type TranscriptState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; messages: Message[] };

export function StudentConversations({
  code,
  conversations,
}: {
  code: string;
  conversations: StudentConversation[];
}) {
  const [open, setOpen] = useState(false);
  // Cache fetched transcripts by threadId so reopening one does not refetch.
  const [cache, setCache] = useState<Record<string, Message[]>>({});
  const [state, setState] = useState<TranscriptState>({ status: "idle" });

  async function openTranscript(threadId: string) {
    setOpen(true);

    const cached = cache[threadId];
    if (cached) {
      setState({ status: "ready", messages: cached });
      return;
    }

    setState({ status: "loading" });
    const messages = await loadConversationTranscript(code, threadId);
    if (messages === undefined) {
      setState({ status: "error" });
      return;
    }
    setCache((c) => ({ ...c, [threadId]: messages }));
    setState({ status: "ready", messages });
  }

  if (conversations.length === 0) {
    return <p className="text-foreground/70">No conversations yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {conversations.map((conversation) => (
          <li key={conversation.threadId}>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-4 rounded-lg border border-foreground/15 bg-background px-3.5 py-2.5 text-left text-sm hover:bg-foreground/5"
              data-testid="conversation-open"
              onClick={() => {
                void openTranscript(conversation.threadId);
              }}
            >
              <span className="whitespace-nowrap font-semibold">
                <LocalTime seconds={seconds(conversation.lastAt)} />
              </span>
              <span className="text-foreground/65">
                {conversation.userMessageCount}{" "}
                {conversation.userMessageCount === 1 ? "message" : "messages"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* size="fit": the dialog hugs short transcripts; when the 85vh cap kicks
          in, the shell's flex column makes the body (flex-1) scroll — no
          hardcoded header-height math. */}
      <DialogShell
        open={open}
        onClose={() => {
          setOpen(false);
          setState({ status: "idle" });
        }}
        title="Conversation"
        size="fit"
        className="w-[min(56rem,92vw)]"
      >
        <div className={DIALOG_BODY}>
          {state.status === "loading" ? (
            <p className="flex items-center gap-2 text-foreground/70">
              <Spinner /> Loading conversation…
            </p>
          ) : state.status === "error" ? (
            <Notice heading="Conversation temporarily unavailable">
              <p>The messages could not be loaded right now. Try again in a moment.</p>
            </Notice>
          ) : state.status === "ready" ? (
            state.messages.length === 0 ? (
              <p className="text-foreground/70">This conversation has no messages.</p>
            ) : (
              <ConversationView messages={state.messages} />
            )
          ) : null}
        </div>
      </DialogShell>
    </>
  );
}
