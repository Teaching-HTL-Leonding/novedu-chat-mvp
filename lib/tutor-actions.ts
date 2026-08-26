"use server";

import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { type CodeRejection, checkCode } from "@/lib/code-store";
import { getThreadTokenSecret, signThreadToken } from "@/lib/thread-token";

// The student-facing tutor server action: "start over", i.e. abandon the current
// conversation and continue in a fresh Mastra thread.
//
// A thread is only usable with its `x-thread-token` — the stateless HMAC over
// `(code, userId, threadId)` keyed off AUTH_SECRET (lib/thread-token.ts,
// server-only) — so the browser CANNOT mint one; clearing the transcript
// client-side would leave the SAME threadId, whose last 40 messages the tutor
// still recalls. Hence this round-trip. It grants nothing new: `app/[code]/page.tsx`
// already mints a fresh thread on every page load, so a student can do the same
// with F5. The code is RE-VERIFIED here (a code that fell out of its window
// mid-session cannot mint another thread) and the user id comes from the session,
// never from the caller.
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

export type StartOverResult =
  | { ok: true; threadId: string; threadToken: string }
  | { ok: false; message: string };

/**
 * Mints a fresh thread id + ownership token for the signed-in user on a valid,
 * in-window tutor code. The caller swaps the pair into the chat surface, whose
 * provider remounts on the new thread (see `providerKey` in app/module-chat.tsx).
 */
export async function startNewTutorThread(input: { code: string }): Promise<StartOverResult> {
  const session = await auth();
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
