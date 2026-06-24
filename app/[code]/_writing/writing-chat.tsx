"use client";

import { CopilotChat, CopilotKitProvider, useFrontendTool } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import type { RefObject } from "react";
import { MarkdownRenderer } from "../../markdown-renderer";
import styles from "./writing-surface.module.css";

// The writing module's feedback chat. Mirrors the tutor chat's provider/chat
// wiring exactly: <CopilotKitProvider> (keyed by code, so navigating between
// codes remounts the provider and starts a fresh thread per code) carries the
// runtime headers (the code + the thread-ownership token, both re-verified by the
// runtime route on every request); the server-issued threadId goes through
// CopilotChat's `threadId` prop (explicit mode) — NOT the configuration provider,
// which would strand the agent mid-run (see app/tutor-chat.tsx for the full why).
//
// THE KEYSTONE — the read-only `getCurrentText` frontend tool. It lives in an
// inner component rendered INSIDE the provider (useFrontendTool must run within
// the CopilotKit context). The handler returns the LIVE editor buffer via the
// ref the parent surface keeps in sync, so the agent can read the student's draft
// on demand without it being typed into the chat. The tool takes NO parameters
// and CANNOT mutate the text — there is no write tool anywhere, so the chat is
// read-only by construction.

// Inner component: registers the frontend tool and renders the chat. Split out so
// `useFrontendTool` runs inside the provider's React context.
function WritingChatInner({
  threadId,
  currentTextRef,
}: {
  threadId: string;
  currentTextRef: RefObject<string>;
}) {
  // Read-only: returns the student's current Markdown draft. The handler reads
  // the ref (kept current by the parent), so it never closes over a stale buffer.
  // No `parameters` — the tool takes no arguments.
  useFrontendTool(
    {
      name: "getCurrentText",
      description:
        "Returns the student's current Markdown draft from the editor. Read-only — you cannot change the text.",
      agentId: "writing",
      handler: async () => currentTextRef.current,
    },
    [currentTextRef],
  );

  // The activity title + description live on the editor pane (left); the chat
  // pane carries only the conversation, so nothing is duplicated above it.
  return (
    <div className={styles.chat}>
      <CopilotChat
        threadId={threadId}
        agentId="writing"
        messageView={{ assistantMessage: { markdownRenderer: MarkdownRenderer } }}
      />
    </div>
  );
}

export function WritingChat({
  code,
  threadId,
  runtimeHeaders,
  currentTextRef,
}: {
  /** The code the activity was opened with — keys the provider per code. */
  code: string;
  /**
   * Server-generated Mastra thread id, signed into the `x-thread-token` runtime
   * header — the runtime rejects any other threadId for this session.
   */
  threadId: string;
  runtimeHeaders: Record<string, string>;
  /** Live editor buffer, kept current by the parent surface for the tool handler. */
  currentTextRef: RefObject<string>;
}) {
  return (
    // Keyed by code: navigating between codes remounts the provider — a fresh
    // thread per code, matching the per-code memory scope. The code travels as a
    // header (x-code), re-checked server-side on every runtime request.
    <CopilotKitProvider key={code} runtimeUrl="/api/copilotkit" headers={runtimeHeaders}>
      <WritingChatInner threadId={threadId} currentTextRef={currentTextRef} />
    </CopilotKitProvider>
  );
}
