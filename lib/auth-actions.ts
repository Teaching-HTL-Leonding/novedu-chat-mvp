"use server";

import { signOut } from "@/auth";

// Server action for the sign-out button in the (client) user menu. Keeping it in
// its own "use server" module lets a client component import and pass it to a
// <form action={...}> without pulling server-only auth code into the client bundle.
export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
