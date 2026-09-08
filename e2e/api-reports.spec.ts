import { expect, test } from "@playwright/test";
import { mintSessionToken } from "./api-auth.utils";

// The /api/reports bearer channel's ACCESS CONTROL over real HTTP: the
// proxy-matcher exclusion (a bare, cookie-less request gets 401 from the route,
// not a sign-in redirect) and the teacher requirement (403 for a valid
// non-teacher token) — for all three routes: GET /api/reports (list),
// GET /api/reports/<id> (show), POST /api/reports/resolve. Everything DB-backed
// (actually filing/listing/resolving a real report) lives in the @live-db
// lifecycle spec (api-reports.live.spec.ts); every assertion here fails inside
// the gate, before any report store call. The bearer credential is a real
// better-auth session token minted straight into `novedu_session`
// (api-auth.utils.ts) — there is no test seam on this channel.

// No cookies: these requests must succeed or fail on the bearer token ALONE. A
// proxy-matcher regression would turn the expected 401 into a sign-in redirect.
test.use({ storageState: { cookies: [], origins: [] } });

// A syntactically valid UUID for the show route — the auth gate fires long
// before the id is ever looked up, so its value is irrelevant here.
const SOME_UUID = "00000000-0000-0000-0000-000000000000";

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
  const headers = { authorization: `Bearer ${await mintSessionToken()}` };

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
