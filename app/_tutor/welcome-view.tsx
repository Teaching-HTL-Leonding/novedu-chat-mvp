"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { type ComponentProps, type HTMLAttributes, useMemo } from "react";
import type { ExampleQuestion } from "@/lib/tutors";

// The tutor welcome screen, isolated from the rest of the chat wiring. It is a
// `chatView` override (the slot ModuleChat forwards to CopilotChat) that re-shows
// the welcome screen explicit-threadId mode would otherwise suppress, and adds
// the tutor's description + clickable example questions on top of the built-in
// greeting.
//
// This override works against CopilotKit internals (it reaches into the view's
// gating flags and the welcome-message slot), so it is fragile across upgrades.
// Pinned to @copilotkit/react-core 1.60.1 — re-verify the flag names and the
// welcomeScreen slot shape when bumping the package.

export function useTutorWelcomeView({
  description,
  exampleQuestions,
}: {
  /** Tutor `description`: rendered below the greeting on the welcome screen. */
  description: string;
  /** ≤5 questions, sampled server-side; clicking one fills the chat input. */
  exampleQuestions: ExampleQuestion[];
}): ComponentProps<typeof CopilotChat>["chatView"] {
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
  return useMemo(() => {
    type ChatViewProps = ComponentProps<typeof CopilotChat.View>;
    function TutorChatView({ onInputChange, ...viewProps }: ChatViewProps) {
      const WelcomeWithDescription = (props: HTMLAttributes<HTMLDivElement>) => (
        <div {...props}>
          <CopilotChat.View.WelcomeMessage />
          {description ? (
            <p className="mx-auto mt-3 max-w-xl text-center text-foreground/65">{description}</p>
          ) : null}
          {exampleQuestions.length > 0 ? (
            <ul className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-1.5">
              {exampleQuestions.map((q) => (
                // Titles alone are not guaranteed unique; the question text is
                // part of the key. The list is static, so content keys are safe.
                <li key={`${q.title}\n${q.question}`}>
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg border border-foreground/15 px-3.5 py-1.5 text-foreground/70 text-sm transition-colors hover:bg-foreground/5 hover:text-foreground"
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
          // prop ModuleChat passes), which suppresses the view's welcome
          // screen. The welcome screen is wanted regardless — it carries the
          // tutor's title, description and example questions — so override the
          // two flags that gate it: the view then shows the welcome screen
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
}
