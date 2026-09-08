import { auth } from "@/auth";

// Bearer-token gate for the CLI/API routes (docs/api.md) — the analogue of
// `checkCode` for codes: every bearer route (see the proxy.ts exclusions) gates
// itself through requireBearerUser / requireBearerTeacher and nothing else.
// Those routes are excluded from the proxy.ts session gate (a CLI has no
// cookie), so THIS module is their entire access control.
//
// The credential is a better-auth session token — the same token the browser
// carries in its signed cookie, handed to the CLI by the device flow. The
// `bearer()` plugin resolves it through `auth.api.getSession`, so a signed-out
// or expired session stops working on this channel immediately, and the teacher
// role is the server-owned `novedu_user.is_teacher` column (recomputed from the
// ID token at every sign-in — see auth.ts), never anything the caller supplies.
//
// ONLY the Authorization header is forwarded to better-auth, so a browser cookie
// can never authenticate this channel: a CSRF-style request from a logged-in
// teacher's browser carries a cookie but no bearer, and is rejected. Nothing
// flows the other way either: sessions never refresh (`disableSessionRefresh` in
// auth.ts), so resolving a bearer emits no session cookie for `nextCookies()` to
// write into the route's response.
//
// SERVER-ONLY: pulls in the auth instance (database, provider credentials).
// Never import from client components.

/** Verified caller identity, as every bearer route consumes it. */
export interface BearerUser {
  /** `novedu_user.id` — the same stable user id the whole app keys on. */
  userId: string;
  /** Display name from `novedu_user.name`. */
  name: string;
  isTeacher: boolean;
}

/**
 * Thrown for every rejected request. `status` is 401 (invalid/missing token)
 * or 403 (valid token, insufficient role); the message is deliberately generic
 * — route handlers return it verbatim without leaking validation detail.
 */
export class ApiAuthError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

/**
 * Resolves the `Authorization: Bearer` session token of an API request and
 * returns the caller. Throws `ApiAuthError` (401) when the header is missing or
 * malformed, and when the token matches no live session.
 */
export async function requireBearerUser(request: Request): Promise<BearerUser> {
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer\s+\S+$/i.test(header)) throw new ApiAuthError(401, "Unauthorized");

  // A fresh Headers object with nothing but the authorization header: whatever
  // else the request carried (a session cookie above all) must not be able to
  // authenticate here.
  const result = await auth.api.getSession({ headers: new Headers({ authorization: header }) });
  if (!result) throw new ApiAuthError(401, "Unauthorized");

  return {
    userId: result.user.id,
    name: result.user.name,
    isTeacher: result.user.isTeacher === true,
  };
}

/**
 * Gate for teacher-only API routes: resolves the bearer session AND requires
 * the teacher role. Throws `ApiAuthError` — 401 for token problems, 403 for a
 * valid non-teacher session. There is no "view as student" on the bearer path
 * (no cookies), so this is always the caller's real role.
 */
export async function requireBearerTeacher(request: Request): Promise<BearerUser> {
  const user = await requireBearerUser(request);
  if (!user.isTeacher) throw new ApiAuthError(403, "Forbidden");
  return user;
}
