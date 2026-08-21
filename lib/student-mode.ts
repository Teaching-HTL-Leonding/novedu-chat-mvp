import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { auth, requireTeacher } from "@/auth";
import { STUDENT_MODE_COOKIE } from "@/lib/student-mode-constants";

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

// Re-exported so the rule and the cookie name stay one import for server callers.
export { STUDENT_MODE_COOKIE };

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
 * THE rule — "real teacher AND not simulating a student" — computed for a
 * session the caller ALREADY has. Every other export in this file derives from
 * it, so the rule has exactly one definition, and this is the only function that
 * reads the raw `session.user.isTeacher` claim on the student-mode-aware path.
 * (`auth.ts`'s `requireTeacher()` reads the claim too, for the channels that have
 * no student mode at all — the CLI/API bearer routes; see `docs/api.md`.)
 *
 * Prefer this overload on a hot path that already called `auth()` (the chat
 * runtime route, which gates reasoning display on it — `docs/chat.md`) so the
 * session JWT is decoded once per request instead of twice. Everywhere else,
 * prefer `getTeacherView()` / `isEffectiveTeacher()`.
 */
export async function teacherViewForSession(session: Session | null): Promise<TeacherView> {
  const realTeacher = session?.user?.isTeacher ?? false;
  const studentMode = realTeacher && (await isStudentMode());
  return { realTeacher, studentMode, effectiveTeacher: realTeacher && !studentMode };
}

/** The rule's boolean half, for a session the caller already has. */
export async function effectiveTeacherForSession(session: Session | null): Promise<boolean> {
  return (await teacherViewForSession(session)).effectiveTeacher;
}

/**
 * THE single source of truth for "how teacher-ish is this user right now".
 * Everything that gates or displays teacher capabilities must derive from this
 * (or the isEffectiveTeacher/requireEffectiveTeacher shorthands below) — never
 * from `session.user.isTeacher` directly, which ignores student mode.
 */
export async function getTeacherView(): Promise<TeacherView> {
  return teacherViewForSession(await auth());
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
  if ((await teacherViewForSession(session)).studentMode) {
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
