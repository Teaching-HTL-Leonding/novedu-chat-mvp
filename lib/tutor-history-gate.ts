import { readAnonymousFlag } from "@/lib/file-validators";
import { ownsTutorThread } from "@/lib/tutor-history-store";

// The tutor's resume rule — one place shared by the resume action
// (lib/tutor-actions.ts) and the snapshot runner that answers the chat's
// `connect` with the stored messages (app/api/copilotkit/history-snapshot-runner.ts).
//
// A tab may bring back its current conversation after a reload only while the
// thread's last stored message is younger than `TUTOR_RESUME_IDLE_MS`. The runner
// allows `TUTOR_RESUME_GRACE_MS` on top: the action checks first, the chat's
// `connect` follows a moment later, and a conversation the action just accepted
// must not be refused by the connect that is meant to deliver it.
//
// "Previous conversations" exists only for a per-user tutor: `historyEnabled`
// needs BOTH copies of the `anonymous` flag false — the one frozen on the code
// row (what the teacher sees) and the live YAML flag (whether `recordUserChat`
// writes `novedu_user_chats` rows) — so the history appears exactly when
// conversations are recorded AND the teacher sees names (docs/codes.md). Past the
// idle limit, the runner still snapshots a thread the session user reopened from
// that list: `ownerMayReopen` re-derives the history gate and the ownership row.
//
// No `"use server"`: imported by a server action module, the runtime route's
// runner, the tutor render and unit tests alike. Server-only through its store
// and YAML imports; `historyEnabled` itself is pure.

/** A conversation idle for this long (since its last stored message) is not resumed. */
export const TUTOR_RESUME_IDLE_MS = 60 * 60 * 1000;

/** The snapshot runner's slack on top of the idle limit (action check → connect). */
export const TUTOR_RESUME_GRACE_MS = 5 * 60 * 1000;

/**
 * `true` when a thread whose last stored message was written at `lastMessageAt`
 * may still be resumed at `now`. A thread with no messages is never resumed (a
 * fresh thread is equivalent), and the limit itself is exclusive.
 */
export function withinResumeWindow(lastMessageAt: Date | null, now: Date, graceMs = 0): boolean {
  if (lastMessageAt === null) return false;
  return now.getTime() - lastMessageAt.getTime() < TUTOR_RESUME_IDLE_MS + graceMs;
}

/** History is on only when the frozen AND the live `anonymous` flags are both `false`. */
export function historyEnabled(frozenAnonymous: boolean, liveAnonymous: boolean): boolean {
  return !frozenAnonymous && !liveAnonymous;
}

/**
 * The live `anonymous` flag of the tutor behind `fileUrl`. A YAML that cannot be
 * loaded counts as anonymous (history off), the privacy-safe default
 * `recordUserChat` uses too.
 */
export async function liveTutorAnonymous(fileUrl: string): Promise<boolean> {
  return (await readAnonymousFlag("tutor", fileUrl)).anonymous;
}

/**
 * Whether the session user may reopen `threadId` regardless of its age: the code
 * is history-enabled (both flags) and a `novedu_user_chats` row ties exactly this
 * `(user, code, thread)` together. `false` on any failure. Never throws.
 */
export async function ownerMayReopen(input: {
  code: string;
  frozenAnonymous: boolean;
  fileUrl: string;
  userId: string;
  threadId: string;
}): Promise<boolean> {
  try {
    if (input.frozenAnonymous) return false;
    if (!historyEnabled(input.frozenAnonymous, await liveTutorAnonymous(input.fileUrl))) {
      return false;
    }
    return (await ownsTutorThread(input.userId, input.code, input.threadId)) === true;
  } catch (error) {
    console.error("tutor-history-gate: checking a reopened conversation failed", error);
    return false;
  }
}
