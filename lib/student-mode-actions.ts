"use server";

import { cookies } from "next/headers";
import { requireTeacher } from "@/auth";
import { STUDENT_MODE_COOKIE } from "./student-mode";

// Server actions toggling student mode. Setting a cookie in a server action
// makes Next refresh the route, so the status bar and pages re-render with the
// new effective role immediately.

export async function enterStudentModeAction() {
  // Only real teachers may enter the simulation (the UI only offers it to
  // them; this is the enforcement). Note: deliberately NOT the effective-
  // teacher check — it would be false once the mode is active.
  await requireTeacher();
  (await cookies()).set(STUDENT_MODE_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function exitStudentModeAction() {
  // Ungated: deleting the cookie only ever RESTORES rights the session
  // already carries — for a real student it is a no-op.
  (await cookies()).delete(STUDENT_MODE_COOKIE);
}
