"use client";

import { useState } from "react";
import { WarningList } from "@/components/validation-result";
import type { RuntimeHeaders } from "@/lib/runtime-headers";
import type { ExampleQuestion, ValidationWarning } from "@/lib/tutors";
import { useTutorWelcomeView } from "./_tutor/welcome-view";
import { CodeBlock } from "./code-block";
import { ModuleChat } from "./module-chat";
import moduleChatStyles from "./module-chat.module.css";
import styles from "./page.module.css";

// The tutor module's chat surface. The shared CopilotKit wiring (provider,
// CopilotChat, the threadId explicit-mode decision, the markdown renderer) lives
// in ModuleChat; this component supplies only the tutor-specific shell — the
// tutor bar, the prompt/warnings preview, the image-upload notice, and the
// welcome-screen override. The server component (app/[code]/render-tutor.tsx)
// checks the code and the tutor YAML and passes the result down — including the
// ready-made runtime headers carrying the code, which travels along on every
// runtime request so the backend can re-check it. The client is never trusted.
//
// The prompt preview is intentionally visible to everyone with a valid link:
// the app is in early preview and the preview is a debugging aid.
// Attachments are capped client-side at 5 MB per image: photos are inlined as
// base64 into the chat request AND replayed from Mastra memory on every
// following turn, so big files would bloat both the request body and the
// model's context.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function TutorChat({
  code,
  threadId,
  tutorUrl,
  runtimeHeaders,
  prompt,
  warnings,
  imageInput,
  title,
  description,
  exampleQuestions = [],
}: {
  /** The code the chat was opened with — keys the provider per code. */
  code: string;
  /**
   * Server-generated Mastra thread id, signed into the `x-thread-token`
   * runtime header — the runtime rejects any other threadId for this session.
   */
  threadId: string;
  tutorUrl: string;
  runtimeHeaders: RuntimeHeaders;
  prompt: string;
  warnings: ValidationWarning[];
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

  return (
    <>
      <div className={styles.tutorBar}>
        <span className={styles.tutorUrl} title={tutorUrl}>
          {tutorUrl}
        </span>
      </div>

      <details className={styles.details}>
        <summary className={styles.detailsSummary}>System prompt &amp; warnings</summary>
        <div className={styles.detailsBody}>
          {warnings.length > 0 ? <WarningList warnings={warnings} /> : null}
          <CodeBlock className="language-markdown">{prompt}</CodeBlock>
        </div>
      </details>

      {uploadError ? (
        <div className={styles.uploadError} role="alert">
          <span>{uploadError}</span>
          <button
            type="button"
            className={styles.uploadErrorDismiss}
            onClick={() => setUploadError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <ModuleChat
        agentId="tutor"
        providerKey={code}
        threadId={threadId}
        headers={runtimeHeaders}
        // Tutor needs no height/padding delta: the base container matches it.
        className={moduleChatStyles.chat}
        labels={title ? { welcomeMessageText: title } : undefined}
        chatView={chatView}
        attachments={
          imageInput
            ? {
                enabled: true,
                accept: "image/*",
                maxSize: MAX_IMAGE_BYTES,
                onUploadFailed: ({ file, message }) => setUploadError(`${file.name}: ${message}`),
              }
            : undefined
        }
      />
    </>
  );
}
