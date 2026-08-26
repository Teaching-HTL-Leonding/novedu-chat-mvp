"use client";

import { useMemo, useState } from "react";
import { ReportButton } from "@/components/report-button";
import { Button } from "@/components/ui/button";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES } from "@/lib/answer-images";
import {
  buildRuntimeHeaders,
  RUNTIME_THREAD_TOKEN_HEADER,
  type RuntimeHeaders,
} from "@/lib/runtime-headers";
import type { ExampleQuestion } from "@/lib/tutors";
import { StartOverButton } from "./_tutor/start-over-button";
import { useTutorWelcomeView } from "./_tutor/welcome-view";
import { ModuleChat } from "./module-chat";

// The tutor module's chat surface. The shared CopilotKit wiring (provider,
// CopilotChat, the threadId explicit-mode decision, the markdown renderer) lives
// in ModuleChat; this component supplies only the tutor-specific shell — the
// image-upload notice and the welcome-screen override. The server component
// (app/[code]/render-tutor.tsx) checks the code and the tutor YAML and passes
// the result down — including the ready-made runtime headers carrying the code,
// which travels along on every runtime request so the backend can re-check it.
// The client is never trusted.
//
// The attachment limits are shared with the quiz module's photo answers
// (lib/answer-images.ts) — see there for why 5 MB.
//
// The thread is the one piece of server state this surface OWNS after mount:
// "start over" swaps in a freshly minted (threadId, threadToken) pair, so the
// props below only SEED it. Everything that identifies the conversation — the
// runtime headers, the report target, the provider remount key — is derived from
// that state, never from the props, so a restart moves them all together.

export function TutorChat({
  code,
  threadId,
  runtimeHeaders,
  imageInput,
  title,
  description,
  exampleQuestions = [],
}: {
  /** The code the chat was opened with — half of the provider key. */
  code: string;
  /**
   * Server-generated Mastra thread id, signed into the `x-thread-token`
   * runtime header — the runtime rejects any other threadId for this session.
   * The INITIAL thread only; "start over" replaces it (see below).
   */
  threadId: string;
  /** Carries the initial thread's ownership token; re-derived after a restart. */
  runtimeHeaders: RuntimeHeaders;
  /** Tutor `llm.imageInput`: students may attach images (vision-capable model). */
  imageInput: boolean;
  /** Tutor `title`: replaces the default "How can I help you today?" greeting. */
  title?: string;
  /** Tutor `description`: rendered below the greeting on the welcome screen. */
  description: string;
  /** ≤5 questions, sampled server-side; clicking one fills the chat input. */
  exampleQuestions?: ExampleQuestion[];
}) {
  const chatView = useTutorWelcomeView({ description, exampleQuestions });
  // Rejected uploads (too large, wrong type) call onUploadFailed and silently
  // drop the file — without this notice the student would never learn why.
  const [uploadError, setUploadError] = useState<string | null>(null);
  // The live conversation, seeded from the server render and replaced wholesale
  // by "start over". Both halves move together — a token only ever proves the
  // thread it was signed for.
  const [thread, setThread] = useState({
    threadId,
    threadToken: runtimeHeaders[RUNTIME_THREAD_TOKEN_HEADER],
  });
  // Memoized so the provider sees a stable headers object between renders and
  // a NEW one exactly when the thread changes.
  const headers = useMemo(
    () => buildRuntimeHeaders(code, thread.threadToken),
    [code, thread.threadToken],
  );

  return (
    <>
      {uploadError ? (
        <div
          className="mx-5 mb-2 flex shrink-0 items-center gap-3 rounded-lg border border-destructive/45 bg-destructive/10 px-3 py-2 text-sm"
          role="alert"
        >
          <span className="wrap-anywhere min-w-0 flex-1">{uploadError}</span>
          <Button variant="outline" size="sm" onClick={() => setUploadError(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* The chat toolbar. "Start over" mints a fresh thread server-side and we
          swap it in here; the report always targets the CURRENT conversation,
          and its server action re-verifies the token over (code, oid, threadId). */}
      <div className="mx-5 mb-2 flex shrink-0 items-center justify-end gap-2">
        <StartOverButton
          code={code}
          onStarted={(next) => {
            setThread(next);
            // A banner about a file the previous conversation rejected must not
            // outlive that conversation.
            setUploadError(null);
          }}
        />
        <ReportButton
          target={{
            kind: "chat",
            code,
            threadId: thread.threadId,
            threadToken: thread.threadToken,
          }}
        />
      </div>

      <ModuleChat
        agentId="tutor"
        // Keyed by code AND thread: "start over" changes the thread half, which
        // remounts the provider and discards the browser's message list — that
        // remount IS the reset (see providerKey in app/module-chat.tsx).
        providerKey={`${code}:${thread.threadId}`}
        threadId={thread.threadId}
        headers={headers}
        // Tutor needs no height/padding delta: ModuleChat's base container matches it.
        labels={title ? { welcomeMessageText: title } : undefined}
        chatView={chatView}
        attachments={
          imageInput
            ? {
                enabled: true,
                accept: IMAGE_ACCEPT,
                maxSize: MAX_IMAGE_BYTES,
                onUploadFailed: ({ file, message }) => setUploadError(`${file.name}: ${message}`),
              }
            : undefined
        }
      />
    </>
  );
}
