"use client";

import type { Message } from "@ag-ui/core";
import {
  CopilotChatAssistantMessage,
  CopilotChatUserMessage,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { MarkdownRenderer } from "../../../../markdown-renderer";
import styles from "./conversation.module.css";

// Read-only transcript. It renders the SAME message components the live chat
// uses (CopilotChatUserMessage / CopilotChatAssistantMessage — the exact ones
// CopilotChatMessageView paints internally), so bubbles, markdown, math and code
// match the real chat. The difference: there is no chat input and no agent — the
// teacher reads, cannot chat.
//
// The CopilotKitProvider is required: those message components reach into
// CopilotKitCore (via the toolbar/copy controls), which only exists under the
// provider. The provider also requires a runtimeUrl (it throws in production
// without one) and pings `/api/copilotkit/info` once on mount — but that route
// serves `/info` as auth-only metadata, so the ping returns 200 even though the
// viewer sends no `x-tutor-code` header. No agent is ever run or connected here.
export function ConversationView({ messages }: { messages: Message[] }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <div className={styles.messages}>
        {messages.map((message) =>
          message.role === "assistant" ? (
            <CopilotChatAssistantMessage
              key={message.id}
              message={message}
              messages={messages}
              markdownRenderer={MarkdownRenderer}
            />
          ) : message.role === "user" ? (
            <CopilotChatUserMessage key={message.id} message={message} />
          ) : null,
        )}
      </div>
    </CopilotKitProvider>
  );
}
