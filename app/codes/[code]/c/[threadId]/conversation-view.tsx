"use client";

import type { Message } from "@ag-ui/core";
import {
  CopilotChatAssistantMessage,
  CopilotChatUserMessage,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { MarkdownRenderer } from "../../../../markdown-renderer";

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
// viewer sends no `x-code` header. No agent is ever run or connected here.
export function ConversationView({ messages }: { messages: Message[] }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {/* The CopilotKit message components paint the bubbles; this stacks them
          with chat-like spacing in a framed, scrollable, width-capped column. */}
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-foreground/15 p-4">
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
