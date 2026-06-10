"use server";

import { cookies } from "next/headers";
import { signOut } from "@/auth";
import { STUDENT_MODE_COOKIE } from "./student-mode";

// Server action for the sign-out button in the (client) user menu. Keeping it in
// its own "use server" module lets a client component import and pass it to a
// <form action={...}> without pulling server-only auth code into the client bundle.
export async function signOutAction() {
  // Student mode must not outlive the session: signOut only clears the Auth.js
  // cookie, so without this the next user signing in on the same browser would
  // silently start in student mode.
  (await cookies()).delete(STUDENT_MODE_COOKIE);
  await signOut({ redirectTo: "/" });
}
