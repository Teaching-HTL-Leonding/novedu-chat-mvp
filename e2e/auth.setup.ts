import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { test as setup } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { COOKIE_NAME, STORAGE_STATE } from "./auth.constants";

// The app is gated by Microsoft Entra ID, so every e2e spec would otherwise be
// redirected to the Microsoft sign-in page. Real auth stays ON — instead of an
// app-side bypass, we mint a valid Auth.js session cookie here (signed with the
// same AUTH_SECRET the dev server uses) and hand it to the browser via
// storageState. This proves the gate genuinely lets a valid session through.

setup("authenticate", async () => {
  // Load `.env` exactly as Next does so AUTH_SECRET is available to this process.
  loadEnvConfig(process.cwd());

  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing — cannot mint an e2e session cookie.");

  const maxAge = 60 * 60; // 1 hour
  const token = await encode({
    token: { name: "E2E User", email: "e2e@example.com", sub: "e2e-user" },
    secret,
    salt: COOKIE_NAME, // the salt must equal the cookie name Auth.js reads
    maxAge,
  });

  const state = {
    cookies: [
      {
        name: COOKIE_NAME,
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
        expires: Math.floor(Date.now() / 1000) + maxAge,
      },
    ],
    origins: [],
  };

  await mkdir(path.dirname(STORAGE_STATE), { recursive: true });
  await writeFile(STORAGE_STATE, JSON.stringify(state, null, 2));
});
