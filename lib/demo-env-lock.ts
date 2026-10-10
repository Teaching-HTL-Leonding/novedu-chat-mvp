// The demo build's environment lock (docs/auth.md, "Demo mode"). A demo build signs
// anyone in as anyone, so it must never run where a real installation's settings
// are present: the Entra credentials, the teacher group, or a public `novedu.at`
// host. Checked twice — by the demo boot in instrumentation.ts (before any database
// work) and by `demoAuthOptions()` when the auth instance is built.
//
// Pure, so it is unit-tested directly; no app imports.

/** The Entra settings a demo build refuses when set to a non-empty value. */
export const ENTRA_ENV_NAMES = [
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "TEACHER_GROUP_ID",
] as const;

const REMEDY =
  "A demo build must not run with a real installation's settings — unset it (from source: blank it in .env.local).";

/** Why a demo build must not start in `env`, or null when it may. */
export function demoBootRefusal(env: Record<string, string | undefined>): string | null {
  for (const name of ENTRA_ENV_NAMES) {
    if (env[name]) return `demo mode: ${name} is set. ${REMEDY}`;
  }
  const authUrl = env.AUTH_URL;
  if (authUrl) {
    let hostname: string;
    try {
      hostname = new URL(authUrl).hostname;
    } catch {
      return `demo mode: AUTH_URL "${authUrl}" is not a valid URL.`;
    }
    // Lower-cased by the URL parser already; a trailing dot names the same host.
    const host = hostname.toLowerCase().replace(/\.$/, "");
    if (host === "novedu.at" || host.endsWith(".novedu.at")) {
      return `demo mode: AUTH_URL names ${host}, a real Novedu installation. ${REMEDY}`;
    }
  }
  return null;
}
