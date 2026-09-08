import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { test as setup } from "@playwright/test";
import {
  COOKIE_NAME,
  E2E_STUDENT,
  E2E_TEACHER,
  STORAGE_STATE,
  TEACHER_STORAGE_STATE,
} from "./auth.constants";
import { closePool, query } from "./db";
import { sessionCookieValue } from "./session-cookie";

// The app is gated by Microsoft Entra ID, so every e2e spec would otherwise be
// bounced to /sign-in. Real auth stays ON — instead of an app-side bypass, we
// create the two principals' rows in the SAME tables better-auth reads
// (`novedu_user` + `novedu_session`) and hand the browser a correctly signed
// session cookie via storageState. Nothing here is a test seam: the server
// resolves these sessions exactly the way it resolves a real sign-in's.
//
// TWO identities are minted so the suite can verify authorization, not just
// authentication: a plain student (`is_teacher = false`) and a teacher
// (`is_teacher = true`, what the sign-in hook writes after resolving the Entra
// group membership).
//
// The cookie value is better-auth's signed form (`e2e/session-cookie.ts`,
// which calls the library's own `makeSignature`), stored under the app's
// `novedu.session_token` cookie name. The signature is not what lets the request
// through — the proxy only checks that the cookie is present — but a session
// better-auth cannot verify resolves to no user, and every page would render
// signed-out (docs/auth.md).

const SESSION_DAYS = 1;

interface Principal {
  id: string;
  name: string;
  email: string;
}

/** Creates (or refreshes) the principal's user row and returns a fresh session token. */
async function mintSession(principal: Principal, isTeacher: boolean): Promise<string> {
  await query(
    `INSERT INTO novedu_user (id, name, email, email_verified, is_teacher, created_at, updated_at)
     VALUES ($1, $2, $3, true, $4, now(), now())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           email = EXCLUDED.email,
           is_teacher = EXCLUDED.is_teacher,
           updated_at = now()`,
    [principal.id, principal.name, principal.email, isTeacher],
  );

  // Previous runs' sessions are dead weight (the storage state that carried them
  // is being overwritten right now), so clear them out instead of letting the
  // table grow one row per principal per run.
  await query(`DELETE FROM novedu_session WHERE user_id = $1`, [principal.id]);

  const token = randomBytes(24).toString("base64url"); // 32 chars
  await query(
    `INSERT INTO novedu_session (id, token, user_id, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, now() + interval '${SESSION_DAYS} day', now(), now())`,
    [randomUUID(), token, principal.id],
  );

  return token;
}

async function writeState(token: string, secret: string, file: string): Promise<void> {
  const state = {
    cookies: [
      {
        name: COOKIE_NAME,
        value: await sessionCookieValue(token, secret),
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
        expires: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60,
      },
    ],
    origins: [],
  };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2));
}

setup("authenticate", async () => {
  // Load `.env` exactly as Next does so AUTH_SECRET is available to this process
  // (`e2e/db.ts` does the same for DATABASE_URL).
  loadEnvConfig(process.cwd());

  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing — cannot sign an e2e session cookie.");

  try {
    // The bearer specs mint one session per call (api-auth.utils.ts) and cannot
    // clean up after themselves — a parallel spec may still be using the
    // principal's other tokens. Sweeping the DEAD ones of the e2e principals
    // here bounds the growth without ever touching a live session, or any
    // session of a real account.
    await query(`DELETE FROM novedu_session WHERE user_id LIKE 'e2e-%' AND expires_at < now()`);

    await writeState(await mintSession(E2E_STUDENT, false), secret, STORAGE_STATE);
    await writeState(await mintSession(E2E_TEACHER, true), secret, TEACHER_STORAGE_STATE);
  } finally {
    await closePool();
  }
});
