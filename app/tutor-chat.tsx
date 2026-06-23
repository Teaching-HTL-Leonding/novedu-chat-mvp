"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { type ComponentProps, type HTMLAttributes, useMemo, useState } from "react";
import { WarningList } from "@/components/validation-result";
import type { ExampleQuestion, ValidationWarning } from "@/lib/tutors";
import { CodeBlock } from "./code-block";
import { MarkdownRenderer } from "./markdown-renderer";
import styles from "./page.module.css";

// The chat surface. There is no tutor input here anymore: the server component
// (app/[code]/render-tutor.tsx) checks the code and the tutor YAML and passes the
// result down — including the ready-made runtime headers carrying the code, which
// travels along on every runtime request so the backend can re-check it. The
// client is never trusted.
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
  runtimeHeaders: Record<string, string>;
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
  // The welcome screen needs to write into the chat input (clicking an example
  // question fills it in), but CopilotChat keeps the input value in internal
  // state and overrides any `inputValue`/`onInputChange` passed to it directly.
  // The one public hook into that state is the `chatView` slot: CopilotChat
  // hands its view all props including `onInputChange` (the internal setter),
  // so we wrap CopilotChat.View and compose the welcome screen here — the
  // built-in greeting (renders `labels.welcomeMessageText`), the description,
  // and the clickable example questions.
  //
  // Memoized: the chat view contains the live input, so a fresh component
  // identity on every TutorChat render (e.g. when uploadError flips) could
  // remount it and lose the student's draft text.
  const ChatView = useMemo(() => {
    type ChatViewProps = ComponentProps<typeof CopilotChat.View>;
    function TutorChatView({ onInputChange, ...viewProps }: ChatViewProps) {
      const WelcomeWithDescription = (props: HTMLAttributes<HTMLDivElement>) => (
        <div {...props}>
          <CopilotChat.View.WelcomeMessage />
          {description ? <p className={styles.welcomeDescription}>{description}</p> : null}
          {exampleQuestions.length > 0 ? (
            <ul className={styles.exampleQuestions}>
              {exampleQuestions.map((q) => (
                // Titles alone are not guaranteed unique; the question text is
                // part of the key. The list is static, so content keys are safe.
                <li key={`${q.title}\n${q.question}`}>
                  <button
                    type="button"
                    className={styles.exampleQuestion}
                    title={q.question}
                    onClick={() => onInputChange?.(q.question)}
                  >
                    {q.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
      return (
        <CopilotChat.View
          {...viewProps}
          onInputChange={onInputChange}
          // CopilotChat runs in explicit-threadId mode (see the `threadId`
          // prop below), which suppresses the view's welcome screen. The
          // welcome screen is wanted regardless — it carries the tutor's
          // title, description and example questions — so override the two
          // flags that gate it: the view then shows the welcome screen
          // exactly while the chat has no messages, as in the default mode.
          hasExplicitThreadId={false}
          isConnecting={false}
          welcomeScreen={
            description || exampleQuestions.length > 0
              ? { welcomeMessage: WelcomeWithDescription }
              : undefined
          }
        />
      );
    }
    // The chatView slot's type is `typeof CopilotChat.View`, which carries the
    // namespace statics (WelcomeMessage, ScrollView, …) — copy them onto the
    // wrapper so it satisfies the slot without a type assertion.
    return Object.assign(TutorChatView, CopilotChat.View);
  }, [description, exampleQuestions]);
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

      <div className={styles.chat}>
        {/*
          The code must NOT go in runtimeUrl's query string: CopilotKit builds
          sub-route URLs (e.g. /info) by appending to runtimeUrl, which would
          yield `/api/copilotkit?code=.../info` (404). Pass it as a header
          instead (x-code), sent on every runtime request and re-checked server-side.
          Keyed by code so navigating between codes remounts the provider — a
          fresh thread per code, matching the per-code memory scope.
        */}
        <CopilotKitProvider key={code} runtimeUrl="/api/copilotkit" headers={runtimeHeaders}>
          {/*
            The server-issued threadId MUST go through CopilotChat's `threadId`
            prop (explicit mode). Pinning it via CopilotChatConfigurationProvider
            with `hasExplicitThreadId={false}` looks equivalent but is not: the
            chat then strands its agent mid-run (messages cleared, stuck
            "running") on the first send. Explicit mode also fires a connect
            request on mount — harmless: the runtime replays the (empty)
            in-process history for the fresh thread, token-checked like a run.
            The welcome screen that explicit mode would suppress is re-enabled
            inside ChatView above.
          */}
          <CopilotChat
            threadId={threadId}
            agentId="tutor"
            labels={title ? { welcomeMessageText: title } : undefined}
            chatView={ChatView}
            messageView={{ assistantMessage: { markdownRenderer: MarkdownRenderer } }}
            attachments={
              imageInput
                ? {
                    enabled: true,
                    accept: "image/*",
                    maxSize: MAX_IMAGE_BYTES,
                    onUploadFailed: ({ file, message }) =>
                      setUploadError(`${file.name}: ${message}`),
                  }
                : undefined
            }
          />
        </CopilotKitProvider>
      </div>
    </>
  );
}
