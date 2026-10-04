import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import type { BrowserContext } from "@playwright/test";
import { COOKIE_NAME } from "./auth.constants";
import { query } from "./db";
import { sessionCookieValue } from "./session-cookie";

// Minting a signed-in principal: a `novedu_user` row plus a `novedu_session`
// row, and the signed cookie a browser sends (docs/auth.md). Shared by the
// suite's auth setup (the two standing principals) and the specs that need a
// FRESH user — one with no history in any table, which the shared principals
// can never guarantee because other specs write usage for them.
//
// Free of Playwright's `test()`, so setup files and specs may import it.

export const SESSION_DAYS = 1;

export interface Principal {
  id: string;
  name: string;
  email: string;
}

/** Creates (or refreshes) the principal's user row and returns a fresh session token. */
export async function mintSession(principal: Principal, isTeacher: boolean): Promise<string> {
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

/** AUTH_SECRET, loaded from `.env` exactly as Next does. */
export function authSecret(): string {
  loadEnvConfig(process.cwd());
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing — cannot sign an e2e session cookie.");
  return secret;
}

/** The session cookie for a minted token, in Playwright's cookie shape. */
export async function sessionCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: await sessionCookieValue(token, authSecret()),
    domain: "localhost",
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax" as const,
    expires: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60,
  };
}

/**
 * A fresh student with no history, signed in on `context`. The id starts with
 * `e2e-` so the auth setup's sweep of dead e2e sessions covers it. Call
 * `deletePrincipal` in a `finally`.
 */
export async function signInFreshStudent(
  context: BrowserContext,
  name: string,
): Promise<Principal> {
  const id = `e2e-${randomUUID()}`;
  const principal = { id, name, email: `${id}@example.com` };
  await context.addCookies([await sessionCookie(await mintSession(principal, false))]);
  return principal;
}

/** Removes a fresh principal's auth rows. */
export async function deletePrincipal(id: string): Promise<void> {
  await query(`DELETE FROM novedu_session WHERE user_id = $1`, [id]);
  await query(`DELETE FROM novedu_user WHERE id = $1`, [id]);
}
