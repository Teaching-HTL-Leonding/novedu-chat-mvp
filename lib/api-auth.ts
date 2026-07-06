import { readFileSync } from "node:fs";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { Profile } from "next-auth";
import { resolveTeacher } from "@/lib/teacher";
import { recordError } from "@/lib/telemetry";

// Bearer-token validation seam for CLI/API routes (docs/api.md) — the analogue
// of `checkCode` for codes: every Entra-bearer route (today GET /api/me) gates
// itself through requireBearerUser / requireBearerTeacher and nothing else.
// These routes are excluded from the proxy.ts session gate (a CLI has no
// cookie), so THIS module is their entire access control.
//
// Tokens are v2 Entra access tokens for the app's own exposed `cli.access`
// scope (same app registration as the web sign-in): issuer
// `https://login.microsoftonline.com/<tenant>/v2.0`, audience = AZURE_CLIENT_ID,
// `scp` containing `cli.access`, user identity in `oid` (never `sub` — see
// auth.ts), teacher role from the `groups` claim via the same resolveTeacher
// used at sign-in (groups overage fails closed).
//
// SERVER-ONLY: reads env configuration and does filesystem/network I/O. Never
// import from client components.

/** Verified caller identity, as future API routes should consume it. */
export interface BearerUser {
  /** Entra `oid` — the same stable user id the whole app keys on. */
  userId: string;
  /** Entra `name` claim (display name); null when the token lacks it. */
  name: string | null;
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

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// The signing-key source is memoized: createRemoteJWKSet caches fetched keys
// (and refetches on unknown-kid), so it must be a single long-lived instance.
//
// TEST SEAM: API_AUTH_JWKS_PATH points at a local JWKS JSON file so tests can
// mint tokens with a generated keypair while validation stays REAL (same
// strategy as the e2e session-cookie minting in e2e/auth.setup.ts). Only the
// signing key is substitutable — issuer and audience always come from the real
// env configuration. The NODE_ENV guard keeps the override inert in
// production, so a stray env var can never weaken a real deployment.
type JwksResolver = ReturnType<typeof createLocalJWKSet> | ReturnType<typeof createRemoteJWKSet>;
let cachedJwks: JwksResolver | undefined;

function getJwks(): JwksResolver {
  if (cachedJwks) return cachedJwks;
  const localPath = process.env.API_AUTH_JWKS_PATH;
  cachedJwks =
    localPath && process.env.NODE_ENV !== "production"
      ? createLocalJWKSet(JSON.parse(readFileSync(localPath, "utf8")))
      : createRemoteJWKSet(
          new URL(
            `https://login.microsoftonline.com/${required("AZURE_TENANT_ID")}/discovery/v2.0/keys`,
          ),
        );
  return cachedJwks;
}

/** Clears the memoized JWKS — for unit tests only. */
export function resetApiAuthForTests(): void {
  cachedJwks = undefined;
}

/** The delegated scope the CLI requests; every bearer token must carry it. */
const REQUIRED_SCOPE = "cli.access";

function hasRequiredScope(scp: unknown): boolean {
  // v2 access tokens carry `scp` as a space-separated string; accept an array
  // defensively as some Entra documentation shows that shape.
  if (typeof scp === "string") return scp.split(" ").includes(REQUIRED_SCOPE);
  if (Array.isArray(scp)) return scp.includes(REQUIRED_SCOPE);
  return false;
}

/**
 * Validates the `Authorization: Bearer` token of an API request and returns
 * the caller. Throws `ApiAuthError` (401) on any missing/invalid token; the
 * underlying reason is recorded via telemetry (never the token itself).
 */
export async function requireBearerUser(request: Request): Promise<BearerUser> {
  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer +(\S+)$/i)?.[1];
  if (!token) throw new ApiAuthError(401, "Unauthorized");

  const tenantId = required("AZURE_TENANT_ID");
  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: required("AZURE_CLIENT_ID"),
    }));
  } catch (error) {
    // jose error messages describe the failed check (signature, exp, iss, …)
    // without reproducing token content — safe for telemetry.
    recordError(error, { "novedu.area": "api-auth" });
    throw new ApiAuthError(401, "Unauthorized");
  }

  if (!hasRequiredScope(payload.scp)) throw new ApiAuthError(401, "Unauthorized");
  const oid = payload.oid;
  if (typeof oid !== "string" || oid === "") throw new ApiAuthError(401, "Unauthorized");

  const { isTeacher, overage } = resolveTeacher(payload as Profile, required("TEACHER_GROUP_ID"));
  if (overage) {
    console.warn(
      "[api-auth] Entra returned a group overage claim; teacher status cannot be derived " +
        "from the token and defaults to non-teacher (same failure mode as the sign-in path).",
    );
  }

  return {
    userId: oid,
    name: typeof payload.name === "string" ? payload.name : null,
    isTeacher,
  };
}

/**
 * Gate for teacher-only API routes: validates the bearer token AND requires
 * the teacher role. Throws `ApiAuthError` — 401 for token problems, 403 for a
 * valid non-teacher token. There is no "view as student" on the bearer path
 * (no cookies), so this is always the caller's real role.
 */
export async function requireBearerTeacher(request: Request): Promise<BearerUser> {
  const user = await requireBearerUser(request);
  if (!user.isTeacher) throw new ApiAuthError(403, "Forbidden");
  return user;
}
