"use client";

import type { Message } from "@ag-ui/core";
import { useRef, useState } from "react";
import { Notice } from "@/components/notice";
import { Spinner } from "@/components/spinner";
import { loadConversationTranscript } from "@/lib/code-stats-actions";
import type { StudentConversation } from "@/lib/code-stats-store";
import { LocalTime } from "../../../../local-time";
import { ConversationView } from "../../c/[threadId]/conversation-view";
import styles from "./student-conversations.module.css";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Cache fetched transcripts by threadId so reopening one does not refetch.
  const [cache, setCache] = useState<Record<string, Message[]>>({});
  const [state, setState] = useState<TranscriptState>({ status: "idle" });

  async function open(threadId: string) {
    dialogRef.current?.showModal();

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
    return <p className={styles.empty}>No conversations yet.</p>;
  }

  return (
    <>
      <ul className={styles.list}>
        {conversations.map((conversation) => (
          <li key={conversation.threadId}>
            <button
              type="button"
              className={styles.item}
              data-testid="conversation-open"
              onClick={() => {
                void open(conversation.threadId);
              }}
            >
              <span className={styles.itemTime}>
                <LocalTime seconds={seconds(conversation.lastAt)} />
              </span>
              <span className={styles.itemCount}>
                {conversation.userMessageCount}{" "}
                {conversation.userMessageCount === 1 ? "message" : "messages"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setState({ status: "idle" })}
      >
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Conversation</span>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
          >
            ✕
          </button>
        </div>
        <div className={styles.dialogBody}>
          {state.status === "loading" ? (
            <p className={styles.loading}>
              <Spinner /> Loading conversation…
            </p>
          ) : state.status === "error" ? (
            <Notice heading="Conversation temporarily unavailable">
              <p>The messages could not be loaded right now. Try again in a moment.</p>
            </Notice>
          ) : state.status === "ready" ? (
            state.messages.length === 0 ? (
              <p className={styles.loading}>This conversation has no messages.</p>
            ) : (
              <ConversationView messages={state.messages} />
            )
          ) : null}
        </div>
      </dialog>
    </>
  );
}
