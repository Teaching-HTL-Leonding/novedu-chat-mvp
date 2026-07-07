import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { importJWK, SignJWT } from "jose";
import { API_AUTH_KID, API_AUTH_PRIVATE_JWK_PATH } from "./api-auth.constants";

// GET /api/me — the CLI/API bearer channel end-to-end: proxy-matcher exclusion
// (401, not a sign-in redirect), lib/api-auth.ts validation and the teacher
// flag, over real HTTP against the dev server. Tokens carry the REAL
// env-configured issuer/audience; only the signing key is the e2e one from
// api-auth.setup.ts (the server trusts it via API_AUTH_JWKS_PATH, injected by
// playwright.config.ts).
//
// CAVEAT (local runs): reuseExistingServer means a dev server you started
// yourself is reused as-is — without API_AUTH_JWKS_PATH in its env these
// specs fail with 401. Restart it with the var exported (pointing at
// e2e/.auth/jwks.json) or let Playwright start the server.

// No cookies: these requests must succeed on the bearer token ALONE. With the
// default (minted session) storage state, a proxy-matcher regression that put
// /api/me behind the cookie gate would be invisible; with an empty state it
// turns the expected 401 into a sign-in redirect and fails the specs.
test.use({ storageState: { cookies: [], origins: [] } });

interface MintOptions {
  groups?: string[];
  expired?: boolean;
}

async function mint({ groups = [], expired = false }: MintOptions = {}): Promise<string> {
  loadEnvConfig(process.cwd());
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!tenantId || !clientId) throw new Error("AZURE_TENANT_ID / AZURE_CLIENT_ID missing in env");

  const privateJwk = JSON.parse(await readFile(API_AUTH_PRIVATE_JWK_PATH, "utf8"));
  const key = await importJWK(privateJwk, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scp: "cli.access", oid: "e2e-api-oid", name: "E2E Api User", groups })
    .setProtectedHeader({ alg: "RS256", kid: API_AUTH_KID })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId)
    .setIssuedAt(expired ? now - 600 : now)
    .setExpirationTime(expired ? now - 300 : now + 300)
    .sign(key);
}

function teacherGroupId(): string {
  loadEnvConfig(process.cwd());
  const id = process.env.TEACHER_GROUP_ID;
  if (!id) throw new Error("TEACHER_GROUP_ID missing in env");
  return id;
}

test("teacher token → identity with isTeacher: true", async ({ request }) => {
  const response = await request.get("/api/me", {
    headers: { authorization: `Bearer ${await mint({ groups: [teacherGroupId()] })}` },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    name: "E2E Api User",
    userId: "e2e-api-oid",
    isTeacher: true,
  });
});

test("non-teacher token → identity with isTeacher: false", async ({ request }) => {
  const response = await request.get("/api/me", {
    headers: { authorization: `Bearer ${await mint()}` },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    name: "E2E Api User",
    userId: "e2e-api-oid",
    isTeacher: false,
  });
});

test("no token → 401 with WWW-Authenticate, not a sign-in redirect", async ({ request }) => {
  const response = await request.get("/api/me", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe("Bearer");
  // { message } is the ONE failure key on the bearer channel (docs/api.md).
  expect(await response.json()).toEqual({ message: "Unauthorized" });
});

test("garbage token → 401", async ({ request }) => {
  const response = await request.get("/api/me", {
    headers: { authorization: "Bearer not-a-jwt" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
});

test("expired token → 401", async ({ request }) => {
  const response = await request.get("/api/me", {
    headers: { authorization: `Bearer ${await mint({ expired: true })}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
});
