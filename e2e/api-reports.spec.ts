import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { importJWK, SignJWT } from "jose";
import { API_AUTH_KID, API_AUTH_PRIVATE_JWK_PATH } from "./api-auth.constants";

// The /api/reports bearer channel's ACCESS CONTROL over real HTTP: the
// proxy-matcher exclusion (a bare, cookie-less request gets 401 from the route,
// not a sign-in redirect) and the teacher requirement (403 for a valid
// non-teacher token) — for all three routes: GET /api/reports (list),
// GET /api/reports/<id> (show), POST /api/reports/resolve. Everything DB-backed
// (actually filing/listing/resolving a real report) lives in the @live-db
// lifecycle spec (api-reports.live.spec.ts); these assertions fail before any
// store call, so this spec stays hermetic. Token minting mirrors
// api-codes.spec.ts (real env issuer/audience, e2e signing key).
//
// CAVEAT (local runs): reuseExistingServer means a dev server started without
// API_AUTH_JWKS_PATH in its env fails these specs with 401-for-everything —
// restart it with the var exported or let Playwright start the server.

// No cookies: these requests must succeed or fail on the bearer token ALONE. A
// proxy-matcher regression would turn the expected 401 into a sign-in redirect.
test.use({ storageState: { cookies: [], origins: [] } });

// A syntactically valid UUID for the show route — the auth gate fires long
// before the id is ever looked up, so its value is irrelevant here.
const SOME_UUID = "00000000-0000-0000-0000-000000000000";

async function mintNonTeacher(): Promise<string> {
  loadEnvConfig(process.cwd());
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!tenantId || !clientId) throw new Error("AZURE_TENANT_ID / AZURE_CLIENT_ID missing in env");

  const privateJwk = JSON.parse(await readFile(API_AUTH_PRIVATE_JWK_PATH, "utf8"));
  const key = await importJWK(privateJwk, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scp: "cli.access", oid: "e2e-api-oid", name: "E2E Api User", groups: [] })
    .setProtectedHeader({ alg: "RS256", kid: API_AUTH_KID })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key);
}

test("bare GET /api/reports → 401 with WWW-Authenticate, not a sign-in redirect", async ({
  request,
}) => {
  const response = await request.get("/api/reports", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe("Bearer");
});

test("bare GET /api/reports/<id> → 401 with WWW-Authenticate, not a sign-in redirect", async ({
  request,
}) => {
  const response = await request.get(`/api/reports/${SOME_UUID}`, { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe("Bearer");
});

test("bare POST /api/reports/resolve → 401 with WWW-Authenticate, not a sign-in redirect", async ({
  request,
}) => {
  const response = await request.post("/api/reports/resolve", {
    data: { ids: [SOME_UUID] },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe("Bearer");
});

test("valid non-teacher token → 403 on all three /api/reports routes", async ({ request }) => {
  const headers = { authorization: `Bearer ${await mintNonTeacher()}` };

  const list = await request.get("/api/reports", { headers });
  expect(list.status()).toBe(403);

  const show = await request.get(`/api/reports/${SOME_UUID}`, { headers });
  expect(show.status()).toBe(403);

  const resolve = await request.post("/api/reports/resolve", {
    headers,
    data: { ids: [SOME_UUID] },
  });
  expect(resolve.status()).toBe(403);
});
