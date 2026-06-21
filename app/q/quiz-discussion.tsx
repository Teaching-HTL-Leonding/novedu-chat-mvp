"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { MarkdownRenderer } from "../markdown-renderer";
import styles from "./quiz-runner.module.css";

// The opt-in per-question discussion chat, mounted in a modal dialog over the
// quiz page. The thread was already minted + seeded server-side by
// `startDiscussion` (question / answer / verdict are persisted as three messages
// the discussion agent recalls for context). CopilotKit's `connect` only replays
// its in-process run cache — empty for a thread seeded directly via memory — so
// the live chat starts visually blank. To give the student context without
// re-printing the whole question + answer, we show just the graded FEEDBACK at the
// top (the verdict card is hidden behind the modal). The student's follow-ups then
// appear in the CopilotChat below; nothing is duplicated in the DB because the
// runtime route trims each run to the new turn, and the model still recalls the
// full seeded context from memory.
//
// Provider keyed by threadId: opening a discussion on another question swaps in a
// fresh thread + token (mirrors how the tutor chat keys its provider per code).
// Headers carry the signed quiz-link params + the thread-ownership token, both
// re-verified by the runtime route's quiz branch on every request.
export function QuizDiscussion({
  threadId,
  headers,
  feedback,
}: {
  threadId: string;
  headers: Record<string, string>;
  feedback: string;
}) {
  return (
    <CopilotKitProvider key={threadId} runtimeUrl="/api/copilotkit" headers={headers}>
      <div className={styles.discussionBody}>
        {feedback ? (
          <div className={styles.discussionFeedback}>
            <MarkdownRenderer content={feedback} />
          </div>
        ) : null}
        <div className={styles.liveChat}>
          <CopilotChat
            threadId={threadId}
            agentId="quizDiscussion"
            messageView={{ assistantMessage: { markdownRenderer: MarkdownRenderer } }}
          />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
