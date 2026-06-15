import { cookies } from "next/headers";
import { auth, requireTeacher } from "@/auth";

// "Student mode": a teacher temporarily views the app as a student would see
// it. While active, every teacher check treats the user as a non-teacher — the
// ONLY teacher capability that remains is exiting the mode again.
//
// State lives in an httpOnly SESSION cookie (no max-age, gone when the browser
// closes — the mode is meant to be temporary). The cookie grants nothing, it
// only RESTRICTS: a student setting it by hand merely opts into what they
// already are, so it needs no signing. Only entering the mode is gated (see
// lib/student-mode-actions.ts).
//
// Kept OUT of auth.ts on purpose: proxy.ts imports auth.ts into the Next proxy
// runtime, where next/headers' cookies() is not available.

export const STUDENT_MODE_COOKIE = "student-mode";

export async function isStudentMode(): Promise<boolean> {
  return (await cookies()).get(STUDENT_MODE_COOKIE)?.value === "1";
}

export interface TeacherView {
  /** The session's actual role (the JWT claim). */
  realTeacher: boolean;
  /** True while a real teacher is simulating a student. */
  studentMode: boolean;
  /** The status the app must ACT on: real teacher AND not simulating. */
  effectiveTeacher: boolean;
}

/**
 * THE single source of truth for "how teacher-ish is this user right now".
 * Everything that gates or displays teacher capabilities must derive from this
 * (or the isEffectiveTeacher/requireEffectiveTeacher shorthands below) — never
 * from `session.user.isTeacher` directly, which ignores student mode.
 */
export async function getTeacherView(): Promise<TeacherView> {
  const session = await auth();
  const realTeacher = session?.user?.isTeacher ?? false;
  const studentMode = realTeacher && (await isStudentMode());
  return { realTeacher, studentMode, effectiveTeacher: realTeacher && !studentMode };
}

/** Shorthand for gating teacher features. */
export async function isEffectiveTeacher(): Promise<boolean> {
  return (await getTeacherView()).effectiveTeacher;
}

/**
 * Like `requireTeacher()`, but also refuses while student mode is active, so
 * teacher-only server work is genuinely unavailable during the simulation.
 */
export async function requireEffectiveTeacher() {
  const session = await requireTeacher();
  if (await isStudentMode()) {
    throw new Error("Forbidden: student mode is active.");
  }
  return session;
}

export type TeacherGate =
  | { ok: true; userId: string }
  | { ok: false; reason: "not-teacher" | "no-user-id" };

/**
 * The standard server-action teacher gate: requires an EFFECTIVE teacher AND a
 * session user id (Entra `oid`). Returns a discriminated result so each action
 * maps the failure to its OWN message and result shape — the security check
 * lives in one place (a missed copy of the gate is a real authz hole) while the
 * wording stays per-action. Callers must `return` on `ok: false` before any
 * privileged work.
 */
export async function requireTeacherUserId(): Promise<TeacherGate> {
  let session: Awaited<ReturnType<typeof requireEffectiveTeacher>>;
  try {
    session = await requireEffectiveTeacher();
  } catch {
    return { ok: false, reason: "not-teacher" };
  }
  const userId = session.user?.id;
  if (!userId) return { ok: false, reason: "no-user-id" };
  return { ok: true, userId };
}
