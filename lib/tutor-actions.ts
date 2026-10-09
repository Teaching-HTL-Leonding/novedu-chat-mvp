"use server";

import { randomUUID } from "node:crypto";
import { type CodeRejection, checkCode } from "@/lib/code-store";
import { getSession } from "@/lib/session";
import { getThreadTokenSecret, signThreadToken, verifyThreadToken } from "@/lib/thread-token";
import { withinResumeWindow } from "@/lib/tutor-history-gate";
import { threadLastMessageAt } from "@/lib/tutor-history-store";

// The student-facing tutor server actions: decide WHICH thread the chat uses.
// None of them returns a message — the conversation itself reaches the browser
// with the chat's `connect` (app/api/copilotkit/history-snapshot-runner.ts).
//
// - "start over" (`startNewTutorThread`): abandon the current conversation and
//   continue in a fresh Mastra thread.
// - "resume" (`resumeTutorThread`): after a reload, may this tab keep the thread
//   it stored in `sessionStorage` (lib/tutor-thread-storage.ts)?
//
// A thread is only usable with its `x-thread-token` — the stateless HMAC over
// `(code, userId, threadId)` keyed off AUTH_SECRET (lib/thread-token.ts,
// server-only) — so the browser CANNOT mint one; clearing the transcript
// client-side would leave the SAME threadId, whose last 40 messages the tutor
// still recalls. Hence the start-over round-trip. It grants nothing new:
// `app/[code]/page.tsx` already mints a fresh thread on every page load. Every
// action RE-VERIFIES the code (a code that fell out of its window mid-session
// cannot mint or resume a thread) and takes the user id from the session, never
// from the caller.
//
// Nothing is persisted and no Mastra call is made: a tutor thread is created
// lazily on its first run, exactly as the page-load path does. The ABANDONED
// thread is left untouched — the teacher can still read it and any report already
// filed against it still resolves.

const CODE_REJECTION_MESSAGES: Record<CodeRejection, string> = {
  "unknown-code": "This code is not valid.",
  "not-started": "This activity's availability window has not started yet.",
  expired: "This activity's availability window has ended.",
  "lookup-failed": "Codes cannot be checked right now — try again in a moment.",
};

// Belt-and-braces shape check before any lookup, as in the runtime route.
const THREAD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export type StartOverResult =
  | { ok: true; threadId: string; threadToken: string }
  | { ok: false; message: string };

/**
 * Mints a fresh thread id + ownership token for the signed-in user on a valid,
 * in-window tutor code. The caller swaps the pair into the chat surface, whose
 * provider remounts on the new thread (see `providerKey` in app/module-chat.tsx).
 */
export async function startNewTutorThread(input: { code: string }): Promise<StartOverResult> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, message: "Please sign in to continue." };

  const verification = await checkCode(input.code);
  if (!verification.ok) {
    return { ok: false, message: CODE_REJECTION_MESSAGES[verification.reason] };
  }
  if (verification.entry.module !== "tutor") {
    return { ok: false, message: "This code is not a tutor." };
  }

  const threadId = randomUUID();
  const threadToken = signThreadToken(
    { code: input.code, userId, threadId },
    getThreadTokenSecret(),
  );
  return { ok: true, threadId, threadToken };
}

/**
 * May this tab keep the thread it stored before a reload? `{ ok: true }` only for
 * the session user's own token over `(code, user, threadId)` on a valid,
 * in-window tutor code whose thread's last stored message is less than
 * `TUTOR_RESUME_IDLE_MS` old (lib/tutor-history-gate.ts). The token is not
 * re-issued; the caller keeps using the one it holds, and the messages arrive
 * with the chat's `connect`. Persists nothing.
 *
 * Every refusal — signed out, a bad code, another user's or another thread's
 * token, an empty or idle thread, a database error — is the same opaque
 * `{ ok: false }`, so the action is no oracle for whether a thread exists, whose
 * it is, or why it was refused.
 */
export async function resumeTutorThread(input: {
  code: string;
  threadId: string;
  threadToken: string;
}): Promise<{ ok: boolean }> {
  const refused = { ok: false };
  if (typeof input.threadId !== "string" || !THREAD_ID_PATTERN.test(input.threadId)) {
    return refused;
  }
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return refused;

  const verification = await checkCode(input.code);
  if (!verification.ok || verification.entry.module !== "tutor") return refused;

  if (
    !verifyThreadToken(
      input.threadToken,
      { code: input.code, userId, threadId: input.threadId },
      getThreadTokenSecret(),
    )
  ) {
    return refused;
  }

  const lastMessageAt = await threadLastMessageAt(input.code, input.threadId);
  if (lastMessageAt === undefined || !withinResumeWindow(lastMessageAt, new Date())) {
    return refused;
  }
  return { ok: true };
}
