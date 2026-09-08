import { expect, test } from "@playwright/test";
import { mintSessionToken } from "./api-auth.utils";

// GET /api/me — the CLI/API bearer channel end-to-end: proxy-matcher exclusion
// (401, not a sign-in redirect), the `lib/api-auth.ts` gate and the teacher
// flag, over real HTTP against the dev server.
//
// The credential is a REAL better-auth session token: `mintSessionToken` writes
// the principal into `novedu_user` and a session row into `novedu_session` (the
// same rows a browser sign-in or the device flow would produce), and the server
// resolves it through `auth.api.getSession` with no test seam anywhere. The
// teacher role comes from the server-owned `is_teacher` column, never from
// anything the caller sends.

// No cookies: these requests must succeed on the bearer token ALONE. With the
// default (minted session) storage state, a proxy-matcher regression that put
// /api/me behind the cookie gate would be invisible; with an empty state it
// turns the expected 401 into a sign-in redirect and fails the specs.
test.use({ storageState: { cookies: [], origins: [] } });

test("teacher session token → identity with isTeacher: true", async ({ request }) => {
  const response = await request.get("/api/me", {
    headers: { authorization: `Bearer ${await mintSessionToken({ teacher: true })}` },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    name: "E2E Api Teacher",
    userId: "e2e-api-teacher",
    isTeacher: true,
  });
});

test("non-teacher session token → identity with isTeacher: false", async ({ request }) => {
  const response = await request.get("/api/me", {
    headers: { authorization: `Bearer ${await mintSessionToken()}` },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    name: "E2E Api User",
    userId: "e2e-api-user",
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
    headers: { authorization: "Bearer not-a-session-token" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
});

test("expired session → 401", async ({ request }) => {
  // The row exists and the token is well-formed — only `expires_at` is in the
  // past, so this proves the gate reads the session's lifetime, not merely its
  // existence.
  const response = await request.get("/api/me", {
    headers: { authorization: `Bearer ${await mintSessionToken({ expired: true })}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
});
