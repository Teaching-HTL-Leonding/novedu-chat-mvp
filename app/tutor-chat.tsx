"use client";

import { useMemo, useRef, useState } from "react";
import { ImageErrorNotice } from "@/components/image-error-notice";
import { ReportButton } from "@/components/report-button";
import {
  IMAGE_ACCEPT_WITH_EXTENSIONS,
  type ImageDiagnostics,
  MAX_RAW_IMAGE_BYTES,
  normalizeStudentImage,
} from "@/lib/image-normalize";
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
// IMAGES: every picked photo goes through `normalizeStudentImage` before it is
// inlined into a run — see lib/image-normalize.ts for why (GitHub #26). Note the
// TWO different size limits: CopilotKit checks `maxSize` against the ORIGINAL
// File, before `onUpload` ever runs, so it must be the ceiling on what a phone
// may hand us (`MAX_RAW_IMAGE_BYTES`); `MAX_IMAGE_BYTES` bounds what we SEND and
// is enforced inside the normalizer, on its output. Setting `maxSize` to the
// send cap is the bug that rejects an ordinary 24 MP phone photo outright.
//
// The thread is the one piece of server state this surface OWNS after mount:
// "start over" swaps in a freshly minted (threadId, threadToken) pair, so the
// props below only SEED it. Everything that identifies the conversation — the
// runtime headers, the report target, the provider remount key — is derived from
// that state, never from the props, so a restart moves them all together.

/** The accumulated upload notice: one sentence per rejected file, plus what we learned about each. */
interface UploadFailures {
  messages: string[];
  diagnostics: ImageDiagnostics[];
}

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
  // Rejected uploads (undecodable, too large, wrong type) call onUploadFailed and
  // silently drop the file — without this notice the student would never learn why.
  const [uploadFailures, setUploadFailures] = useState<UploadFailures | null>(null);
  // `onUpload` knows WHY a file was rejected but must throw for CopilotKit to
  // drop the placeholder chip; `onUploadFailed` is where the reason surfaces.
  // The diagnostics ride between them here, so state is written in exactly one place.
  const pendingDiagnostics = useRef<ImageDiagnostics | null>(null);
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

  function addFailure(message: string, diagnostics: ImageDiagnostics | null) {
    setUploadFailures((prev) => ({
      messages: [...(prev?.messages ?? []), message],
      diagnostics: [...(prev?.diagnostics ?? []), ...(diagnostics ? [diagnostics] : [])],
    }));
  }

  return (
    <>
      {uploadFailures ? (
        <ImageErrorNotice
          className="mx-5 mb-2 shrink-0"
          diagnostics={uploadFailures.diagnostics}
          messages={uploadFailures.messages}
          onDismiss={() => setUploadFailures(null)}
          origin="tutor chat"
        />
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
            setUploadFailures(null);
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
                accept: IMAGE_ACCEPT_WITH_EXTENSIONS,
                maxSize: MAX_RAW_IMAGE_BYTES,
                onUpload: async (file) => {
                  const result = await normalizeStudentImage(file);
                  pendingDiagnostics.current = result.diagnostics;
                  if (!result.ok) throw new Error(result.message);
                  // CopilotKit wants the bare base64 payload, with the media type
                  // beside it — not the data URL the normalizer hands back.
                  return {
                    type: "data",
                    value: result.dataUrl.slice(result.dataUrl.indexOf(",") + 1),
                    mimeType: result.mimeType,
                  };
                },
                onUploadFailed: ({ reason, file, message }) => {
                  // REPLACE the library's stock English wording rather than
                  // appending to it: it names the raw ceiling, which is an
                  // implementation detail the student cannot act on.
                  const diagnostics = pendingDiagnostics.current;
                  pendingDiagnostics.current = null;
                  if (reason === "upload-failed") {
                    addFailure(message, diagnostics);
                  } else if (reason === "file-too-large") {
                    addFailure(
                      `${file.name}: this photo is too large to send. Take it again at a lower resolution, or pick a smaller copy.`,
                      null,
                    );
                  } else {
                    addFailure(`${file.name}: only photos can be attached.`, null);
                  }
                },
              }
            : undefined
        }
      />
    </>
  );
}
