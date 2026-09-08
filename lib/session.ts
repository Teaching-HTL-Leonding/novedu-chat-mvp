import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/auth";

// The session seam for every cookie-authenticated surface (pages, server
// actions, the chat runtime route). Everything reads the session through here,
// so `auth.ts` — and with it the auth instance's configuration — has exactly one
// consumer shape to satisfy.
//
// There is no cookie cache: each call goes to the database (an indexed lookup on
// `novedu_session.token`, plus the user row), so a sign-out or a changed teacher
// role takes effect on the next request.

export type { Session } from "@/auth";

/**
 * The signed-in `{ session, user }` pair, or `null`.
 *
 * Wrapped in React's `cache()`, so the several callers of one render (the page,
 * the status bar, the student-mode helpers) share a single lookup per request.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Guard for teacher-only server work (server actions / route handlers). Returns
 * the session when the caller is a teacher, otherwise throws. Callers in a route
 * handler should catch this and respond 403.
 *
 * This reads the RAW role. Every cookie surface must go through
 * `requireEffectiveTeacher()` (lib/student-mode.ts) instead, which also refuses
 * while a teacher is viewing the app as a student; the raw check is for the
 * channels that have no student mode at all (the CLI/API bearer routes).
 */
export async function requireTeacher() {
  const session = await getSession();
  if (!session?.user?.isTeacher) {
    throw new Error("Forbidden: this operation requires a teacher account.");
  }
  return session;
}
