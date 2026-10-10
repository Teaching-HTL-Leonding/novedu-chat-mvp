// The demo build's HTTP surface under /api/auth (docs/auth.md, "Demo mode"). The
// personas are shared by everyone who can reach the instance, so every better-auth
// endpoint that touches a user's own account or sessions would leak between
// visitors (`/list-sessions` hands out the others' session tokens, `/revoke-sessions`
// signs everyone out, `/change-password` locks everyone out). An ALLOWLIST rather
// than a deny-list, so an endpoint a later better-auth release adds stays closed
// until someone reviews it (`lib/auth-demo-allowlist.unit.test.ts` pins the list
// against the installed package).
//
// Loaded only by `await import()` inside the auth route's demo branch. Server-side
// `auth.api.*` calls (the /device page, `getSession`) never pass through the route.

/** `METHOD /path` (relative to /api/auth) of every endpoint a demo build serves. */
export const DEMO_AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  // The sign-in page's buttons.
  "POST /sign-in/email",
  // The CLI's `logout` (bearer); the browser signs out through a server action.
  "POST /sign-out",
  // The browser client's session read after signing in.
  "GET /get-session",
  // The CLI's device flow: request a code, then poll for the token. Viewing,
  // approving and denying a code happen server-side on the /device page.
  "POST /device/code",
  "POST /device/token",
]);

const BASE_PATH = "/api/auth";

/**
 * The request's path relative to /api/auth, normalized the way better-auth's own
 * router does it (trailing slashes dropped, the base path stripped) so the match
 * below sees the path better-auth would dispatch on.
 */
export function demoAuthPath(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
  if (pathname === BASE_PATH) return "/";
  if (pathname.startsWith(`${BASE_PATH}/`)) {
    return pathname.slice(BASE_PATH.length).replace(/\/+$/, "") || "/";
  }
  return pathname;
}

/** Whether a demo build serves this request (exact method + path match). */
export function demoAuthAllows(request: Request): boolean {
  return DEMO_AUTH_ENDPOINTS.has(`${request.method} ${demoAuthPath(request.url)}`);
}
