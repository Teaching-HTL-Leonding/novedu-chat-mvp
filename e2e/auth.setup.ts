import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { test as setup } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { COOKIE_NAME, STORAGE_STATE, TEACHER_STORAGE_STATE } from "./auth.constants";

// The app is gated by Microsoft Entra ID, so every e2e spec would otherwise be
// redirected to the Microsoft sign-in page. Real auth stays ON — instead of an
// app-side bypass, we mint valid Auth.js session cookies here (signed with the
// same AUTH_SECRET the dev server uses) and hand them to the browser via
// storageState. This proves the gate genuinely lets a valid session through.
//
// TWO identities are minted so the suite can verify authorization, not just
// authentication: a plain student (no isTeacher claim → session.user.isTeacher
// is false) and a teacher (isTeacher: true, exactly what the jwt callback would
// store after resolving the Entra group membership at sign-in).

const MAX_AGE = 60 * 60; // 1 hour

async function mintState(
  secret: string,
  token: Record<string, unknown>,
  file: string,
): Promise<void> {
  const value = await encode({
    token,
    secret,
    salt: COOKIE_NAME, // the salt must equal the cookie name Auth.js reads
    maxAge: MAX_AGE,
  });

  const state = {
    cookies: [
      {
        name: COOKIE_NAME,
        value,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
        expires: Math.floor(Date.now() / 1000) + MAX_AGE,
      },
    ],
    origins: [],
  };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2));
}

setup("authenticate", async () => {
  // Load `.env` exactly as Next does so AUTH_SECRET is available to this process.
  loadEnvConfig(process.cwd());

  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing — cannot mint an e2e session cookie.");

  await mintState(
    secret,
    { name: "E2E Student", email: "e2e-student@example.com", sub: "e2e-student" },
    STORAGE_STATE,
  );
  await mintState(
    secret,
    {
      name: "E2E Teacher",
      email: "e2e-teacher@example.com",
      sub: "e2e-teacher",
      isTeacher: true,
    },
    TEACHER_STORAGE_STATE,
  );
});
