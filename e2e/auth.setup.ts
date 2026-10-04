import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { E2E_STUDENT, E2E_TEACHER, STORAGE_STATE, TEACHER_STORAGE_STATE } from "./auth.constants";
import { closePool, query } from "./db";
import { authSecret, mintSession, sessionCookie } from "./principal.utils";

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
// The rows and the cookie come from `e2e/principal.utils.ts`. The cookie value
// is better-auth's signed form (`e2e/session-cookie.ts`,
// which calls the library's own `makeSignature`), stored under the app's
// `novedu.session_token` cookie name. The signature is not what lets the request
// through — the proxy only checks that the cookie is present — but a session
// better-auth cannot verify resolves to no user, and every page would render
// signed-out (docs/auth.md).

async function writeState(token: string, file: string): Promise<void> {
  const state = { cookies: [await sessionCookie(token)], origins: [] };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2));
}

setup("authenticate", async () => {
  // Fail before touching the database when the cookie cannot be signed.
  authSecret();

  try {
    // The bearer specs mint one session per call (api-auth.utils.ts) and cannot
    // clean up after themselves — a parallel spec may still be using the
    // principal's other tokens. Sweeping the DEAD ones of the e2e principals
    // here bounds the growth without ever touching a live session, or any
    // session of a real account.
    await query(`DELETE FROM novedu_session WHERE user_id LIKE 'e2e-%' AND expires_at < now()`);

    await writeState(await mintSession(E2E_STUDENT, false), STORAGE_STATE);
    await writeState(await mintSession(E2E_TEACHER, true), TEACHER_STORAGE_STATE);
  } finally {
    await closePool();
  }
});
