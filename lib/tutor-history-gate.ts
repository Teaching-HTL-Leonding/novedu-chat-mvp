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
// Pure, no `"use server"`: imported by a server action module, the runtime route's
// runner and unit tests alike.

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
