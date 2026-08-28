import { expect, test } from "@playwright/test";
import { mintToken } from "./api-auth.utils";

// The /api/images bearer channel's ACCESS CONTROL over real HTTP: the
// proxy-matcher exclusion (a bare request gets 401 from the route, not a
// sign-in redirect) and the teacher requirement (403 for a valid non-teacher
// token) — for the list, upload-request and confirm routes alike. Everything
// Blob-Storage-backed (actually uploading) lives with the @live-storage image
// lifecycle spec; these assertions fail inside requireBearerTeacher, before
// any store or blob call, so this spec stays hermetic. Token minting mirrors
// api-me.spec.ts (real env issuer/audience, e2e signing key).
//
// CAVEAT (local runs): reuseExistingServer means a dev server started without
// API_AUTH_JWKS_PATH in its env fails these specs with 401-for-everything —
// restart it with the var exported or let Playwright start the server.

// No cookies: these requests must succeed or fail on the bearer token ALONE. A
// proxy-matcher regression would turn the expected 401 into a sign-in redirect.
test.use({ storageState: { cookies: [], origins: [] } });

test("bare GET /api/images → 401 with WWW-Authenticate, not a sign-in redirect", async ({
  request,
}) => {
  const response = await request.get("/api/images", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe("Bearer");
});

test("bare POST /api/images/<name> (upload request) → 401, not a sign-in redirect", async ({
  request,
}) => {
  const response = await request.post("/api/images/e2e-api-gate-probe", {
    data: { mime: "image/png", byteSize: 1 },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe("Bearer");
});

test("bare POST /api/images/<name>/confirm → 401, not a sign-in redirect", async ({ request }) => {
  const response = await request.post("/api/images/e2e-api-gate-probe/confirm", {
    data: { blobPath: "x.png", mime: "image/png" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
});

test("valid non-teacher token → 403 on all three /api/images routes", async ({ request }) => {
  const token = await mintToken();
  const headers = { authorization: `Bearer ${token}` };

  const list = await request.get("/api/images", { headers });
  expect(list.status()).toBe(403);

  const slot = await request.post("/api/images/e2e-api-gate-probe", {
    headers,
    data: { mime: "image/png", byteSize: 1 },
  });
  expect(slot.status()).toBe(403);

  const confirm = await request.post("/api/images/e2e-api-gate-probe/confirm", {
    headers,
    data: { blobPath: "x.png", mime: "image/png" },
  });
  expect(confirm.status()).toBe(403);
});
