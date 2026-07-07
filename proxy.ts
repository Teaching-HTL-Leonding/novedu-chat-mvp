// The access gate. In Next.js 16 the `middleware` convention was renamed to
// `proxy`, so the classic Auth.js `export { auth as middleware }` becomes
// `export { auth as proxy }`. Auth.js's `auth` wrapper runs the `authorized`
// callback from `auth.ts` and redirects unauthenticated requests to the sign-in
// page.
export { auth as proxy } from "@/auth";

export const config = {
  // Protect everything (pages + /api/copilotkit) EXCEPT the
  // Auth.js endpoints (needed to complete sign-in), the public /api/version
  // build-identity probe (CD triage — see app/api/version/route.ts), the public
  // /api/files YAML-hosting endpoint (served without a session so the tutor-code
  // loader can fetch it — see app/api/files/[name]/route.ts), and static assets.
  // The public /api/coding OpenAI-compatible coding endpoint is gated by the
  // code-as-bearer-key (re-checked every request), not by an Entra session — an
  // external coding agent has none — so it is excluded here too (see
  // app/api/coding/v1/chat/completions/route.ts). It is anchored with a path
  // boundary (`api/coding(?:/|$)`) so the exclusion cannot silently widen to a
  // future, unrelated `/api/coding-*` route.
  // The /api/me identity probe is a CLI/API bearer-token route: it self-gates
  // via requireBearerUser (lib/api-auth.ts) and a CLI has no Entra session
  // cookie, so it must not hit the cookie gate (see docs/api.md). Every future
  // bearer route gets its own explicit, path-bounded exclusion like this one —
  // never a blanket prefix.
  // Without a matcher the proxy would also run on _next/static, blocking CSS/JS.
  matcher: [
    "/((?!api/auth|api/version|api/files|api/coding(?:/|$)|api/me(?:/|$)|_next/static|_next/image|favicon.ico).*)",
  ],
};
