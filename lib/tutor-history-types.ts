// Shared shapes of the tutor history ("Previous conversations"): produced by
// lib/tutor-history-store.ts, returned by the server actions in
// lib/tutor-actions.ts, rendered by app/_tutor/previous-conversations-button.tsx.
// A separate, type-only module because a `"use server"` file must not re-export
// types (it crashes at load), and the client must not import the store.

/** One of the student's own conversations with a tutor, as the history list shows it. */
export interface TutorThreadSummary {
  threadId: string;
  /** When the conversation's latest message (student or tutor) was written. */
  lastActivityAt: Date;
  /** How many messages the STUDENT wrote (always ≥ 1). */
  userMessageCount: number;
  /** The first student message, shortened; a photo-only message has no text. */
  preview: { kind: "text"; text: string } | { kind: "photo" };
}

export type ListTutorThreadsResult =
  | { ok: true; threads: TutorThreadSummary[]; more: boolean }
  | { ok: false };

export type OpenTutorThreadResult =
  | { ok: true; threadToken: string }
  | { ok: false; message: string };
