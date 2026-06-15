// The access gate. In Next.js 16 the `middleware` convention was renamed to
// `proxy`, so the classic Auth.js `export { auth as middleware }` becomes
// `export { auth as proxy }`. Auth.js's `auth` wrapper runs the `authorized`
// callback from `auth.ts` and redirects unauthenticated requests to the sign-in
// page.
export { auth as proxy } from "@/auth";

export const config = {
  // Protect everything (pages + /api/copilotkit + /api/validate-tutor) EXCEPT the
  // Auth.js endpoints (needed to complete sign-in), the public /api/version
  // build-identity probe (CD triage — see app/api/version/route.ts), the public
  // /api/files YAML-hosting endpoint (served without a session so the tutor-code
  // loader can fetch it — see app/api/files/[name]/route.ts), and static assets.
  // Without a matcher the proxy would also run on _next/static, blocking CSS/JS.
  matcher: ["/((?!api/auth|api/version|api/files|_next/static|_next/image|favicon.ico).*)"],
};
