import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { importJWK, SignJWT } from "jose";
import { API_AUTH_KID, API_AUTH_PRIVATE_JWK_PATH } from "./api-auth.constants";

// Mints the bearer tokens the CLI/API specs drive `lib/api-auth.ts` with. Seven
// specs used to carry their own copy of this; the copies drifted only in the
// claims, never in the mechanics, so the shape below is the union of what they
// asked for and nothing more.
//
// The token carries the REAL env-configured issuer/audience — only the signing
// key is the e2e one from api-auth.setup.ts, which the dev server trusts via
// API_AUTH_JWKS_PATH (injected by playwright.config.ts). That is what keeps
// these specs a test of the real validator rather than of a stub.

export interface MintTokenOptions {
  /** Add the configured teacher group to `groups`, so the token passes `requireBearerTeacher`. */
  teacher?: boolean;
  /** Extra group ids, on top of `teacher`. Defaults to none — i.e. a valid NON-teacher token. */
  groups?: string[];
  /** The Entra object id, which is the session user id (`oid`, never `sub`). */
  oid?: string;
  name?: string;
  /** Lifetime in seconds. Ignored when `expired` is set. */
  ttlSeconds?: number;
  /** Mint a token that already expired, to prove the validator rejects it. */
  expired?: boolean;
}

/** The group id that makes a bearer principal a teacher. Throws rather than silently minting a student. */
export function teacherGroupId(): string {
  loadEnvConfig(process.cwd());
  const id = process.env.TEACHER_GROUP_ID;
  if (!id) throw new Error("TEACHER_GROUP_ID missing in env");
  return id;
}

export async function mintToken({
  teacher = false,
  groups = [],
  oid = "e2e-api-oid",
  name = "E2E Api User",
  ttlSeconds = 300,
  expired = false,
}: MintTokenOptions = {}): Promise<string> {
  loadEnvConfig(process.cwd());
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!tenantId || !clientId) throw new Error("AZURE_TENANT_ID / AZURE_CLIENT_ID missing in env");

  const allGroups = teacher ? [...groups, teacherGroupId()] : groups;
  const privateJwk = JSON.parse(await readFile(API_AUTH_PRIVATE_JWK_PATH, "utf8"));
  const key = await importJWK(privateJwk, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scp: "cli.access", oid, name, groups: allGroups })
    .setProtectedHeader({ alg: "RS256", kid: API_AUTH_KID })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId)
    .setIssuedAt(expired ? now - 600 : now)
    .setExpirationTime(expired ? now - 300 : now + ttlSeconds)
    .sign(key);
}
