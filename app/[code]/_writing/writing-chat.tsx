"use client";

import { useFrontendTool } from "@copilotkit/react-core/v2";
import type { RefObject } from "react";
import type { RuntimeHeaders } from "@/lib/runtime-headers";
import { computeTextStats } from "@/lib/writing-stats";
import { ModuleChat } from "../../module-chat";

// The writing module's feedback chat: the shared ModuleChat primitive plus the
// module's one slot — the read-only `getCurrentText` frontend tool.
//
// THE KEYSTONE — the read-only `getCurrentText` frontend tool. It lives in an
// inner component rendered INSIDE the provider (useFrontendTool must run within
// the CopilotKit context, which ModuleChat establishes around its children). The
// handler returns the LIVE editor buffer (plus live length statistics) via the
// ref the parent surface keeps in sync, so the agent can read the student's draft
// on demand without it being typed into the chat. The tool takes NO parameters
// and CANNOT mutate the text — there is no write tool anywhere, so the chat is
// read-only by construction.

// Registers the frontend tool and renders nothing. Split out so `useFrontendTool`
// runs inside the provider's React context (it is a ModuleChat child).
function GetCurrentTextTool({ currentTextRef }: { currentTextRef: RefObject<string> }) {
  // Read-only: returns the student's current Markdown draft plus its live
  // statistics (character / word / paragraph counts) so the assistant can check a
  // prompt's length requirements. The handler reads the ref (kept current by the
  // parent), so it never closes over a stale buffer. No `parameters` — the tool
  // takes no arguments.
  useFrontendTool(
    {
      name: "getCurrentText",
      description:
        "Returns the student's current Markdown draft from the editor together with live length statistics: text, charactersIncludingWhitespace, charactersExcludingWhitespace, words, and paragraphs (use these to check length requirements). Read-only — you cannot change the text.",
      agentId: "writing",
      handler: async () => {
        const text = currentTextRef.current;
        return { text, ...computeTextStats(text) };
      },
    },
    [currentTextRef],
  );

  return null;
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
  runtimeHeaders: RuntimeHeaders;
  /** Live editor buffer, kept current by the parent surface for the tool handler. */
  currentTextRef: RefObject<string>;
}) {
  // The activity title + description live on the editor pane (left); the chat
  // pane carries only the conversation, so nothing is duplicated above it. Keyed
  // by code (providerKey) so navigating between codes remounts a fresh per-code
  // thread.
  return (
    <ModuleChat
      agentId="writing"
      providerKey={code}
      threadId={threadId}
      headers={runtimeHeaders}
      // Deltas only (column flex + horizontal padding so messages + input are
      // not glued to the pane border) — the fill recipe is ModuleChat's own.
      className="flex flex-col px-3"
    >
      <GetCurrentTextTool currentTextRef={currentTextRef} />
    </ModuleChat>
  );
}
