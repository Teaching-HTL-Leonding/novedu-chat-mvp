import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { mintSessionToken } from "./api-auth.utils";

// The /api/images bearer channel's ACCESS CONTROL over real HTTP: the
// proxy-matcher exclusion (a bare request gets 401 from the route, not a
// sign-in redirect) and the teacher requirement (403 for a valid non-teacher
// token) — for the list and upload routes alike. Everything filesystem-backed
// (actually uploading bytes) lives with the @live @live-db image lifecycle
// spec; these assertions fail inside requireBearerTeacher, before any body is
// read, service call or store call. The bearer credential is a real
// better-auth session token minted straight into `novedu_session`
// (api-auth.utils.ts) — there is no test seam on this channel.
//
// GET /api/image-content/<id> is the OTHER image route, and it is the opposite
// shape: a cookie-session route with NO proxy exclusion (docs/images.md), so a
// bare request must be bounced to /sign-in exactly like any page.

// No cookies: these requests must succeed or fail on the bearer token ALONE
// (or, for the content route, on the absence of a session cookie). A
// proxy-matcher regression would turn the expected 401 into a sign-in redirect.
test.use({ storageState: { cookies: [], origins: [] } });

// A minimal, byte-valid multipart body — the routes under test here reject
// before reading it at all (auth first), so its content never matters.
const TINY_FILE = { name: "probe.png", mimeType: "image/png", buffer: Buffer.from([0]) };

test("bare GET /api/images → 401 with WWW-Authenticate, not a sign-in redirect", async ({
  request,
}) => {
  const response = await request.get("/api/images", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe("Bearer");
});

test("bare multipart POST /api/images/<name> → 401, not a sign-in redirect", async ({
  request,
}) => {
  const response = await request.post("/api/images/e2e-api-gate-probe", {
    multipart: { file: TINY_FILE, mime: "image/png" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe("Bearer");
});

test("valid non-teacher token → 403 on GET list and POST upload", async ({ request }) => {
  const token = await mintSessionToken();
  const headers = { authorization: `Bearer ${token}` };

  const list = await request.get("/api/images", { headers });
  expect(list.status()).toBe(403);

  const upload = await request.post("/api/images/e2e-api-gate-probe", {
    headers,
    multipart: { file: TINY_FILE, mime: "image/png" },
  });
  expect(upload.status()).toBe(403);
});

test("bare GET /api/image-content/<id> → redirected to /sign-in (cookie gate, no exclusion)", async ({
  request,
}) => {
  const response = await request.get(`/api/image-content/${randomUUID()}`, { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toContain("/sign-in");
});
