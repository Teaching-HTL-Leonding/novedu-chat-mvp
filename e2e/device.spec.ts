import type { APIRequestContext, Browser } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { E2E_TEACHER, TEACHER_STORAGE_STATE } from "./auth.constants";
import { query } from "./db";

// @live-db: the CLI sign-in loop end-to-end over real HTTP — the one flow that
// only exists as a three-party handshake and therefore cannot be proven in
// process: the tool asks for a device code, a signed-in person approves it in
// the browser (which is also what CLAIMS the code for that account), the tool
// redeems it for a session token, and that token is a working bearer credential
// on /api/me. The denial half is tested too, because "denied" must reach the
// waiting tool as a hard error rather than a timeout.
//
// Everything hits the real database (novedu_device_code + novedu_session), so
// @live-db. No LLM anywhere.
//
// All approvals run as the TEACHER principal, so the redeemed token must come
// back with isTeacher: true — that is what proves the token carries the SERVER's
// role for the approving user, not anything the caller asked for.
test.use({ storageState: TEACHER_STORAGE_STATE });
// Dev compilation of /device + /api/auth/** + several DB round-trips.
test.setTimeout(120_000);

const CLIENT_ID = "novedu-cli";
// The browser context carries the teacher's session cookie, and better-auth
// requires a trusted Origin on any cookie-bearing POST — Playwright's request
// fixture sends none by default.
const ORIGIN = { origin: "http://localhost:3000" };

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  interval: number;
}

/** The tool's first step: ask for a code pair. */
async function requestDeviceCode(request: APIRequestContext): Promise<DeviceCode> {
  const response = await request.post("/api/auth/device/code", {
    headers: ORIGIN,
    data: { client_id: CLIENT_ID },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

/** The tool's poll. Returns the raw response so both outcomes can be asserted. */
function pollDeviceToken(request: APIRequestContext, deviceCode: string) {
  return request.post("/api/auth/device/token", {
    headers: ORIGIN,
    data: {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CLIENT_ID,
    },
  });
}

// Redeemed and denied codes delete their own row (the token endpoint consumes
// one and deletes the other), so this only sweeps up a row a mid-test failure
// left behind.
const createdUserCodes: string[] = [];

test.afterAll(async () => {
  for (const userCode of createdUserCodes) {
    await query(`DELETE FROM novedu_device_code WHERE user_code = $1`, [userCode]);
  }
});

test("approve a device code, redeem it, and use the token as a bearer", {
  tag: ["@live", "@live-db"],
}, async ({ page, request }) => {
  const code = await requestDeviceCode(request);
  createdUserCodes.push(code.user_code);

  expect(code.verification_uri_complete).toContain("/device?user_code=");
  expect(code.user_code).toMatch(/^[A-Z0-9]{8}$/);

  // The person opens the printed link. Rendering it claims the code for this
  // account — which is why the buttons appear at all.
  await page.goto(`/device?user_code=${code.user_code}`);
  await expect(page.getByRole("heading", { name: "Approve this sign-in?" })).toBeVisible();
  // A focused approval screen: no app chrome around the decision.
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveCount(0);
  await expect(page.getByText(CLIENT_ID)).toBeVisible();
  await expect(page.getByText(E2E_TEACHER.email)).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();

  // The waiting tool's next poll now gets a token.
  const tokenResponse = await pollDeviceToken(request, code.device_code);
  expect(tokenResponse.status()).toBe(200);
  const granted = await tokenResponse.json();
  expect(granted.token_type).toBe("Bearer");
  expect(typeof granted.access_token).toBe("string");

  const authorization = `Bearer ${granted.access_token}`;

  // The whole point: that token authenticates the CLI/API channel as the person
  // who approved it, with the server-owned teacher role.
  const me = await request.get("/api/me", { headers: { authorization } });
  expect(me.status()).toBe(200);
  expect(await me.json()).toEqual({
    name: E2E_TEACHER.name,
    userId: E2E_TEACHER.id,
    isTeacher: true,
  });

  // Sign the minted CLI session out again (what `novedu-cli logout` does), so
  // the run leaves no live session behind. The bearer plugin replaces the
  // request's cookie with the bearer token, so this revokes THAT session — never
  // the browser one the storage state carries.
  const signOut = await request.post("/api/auth/sign-out", {
    headers: { authorization, "content-type": "application/json", ...ORIGIN },
    data: {},
  });
  expect(signOut.status()).toBe(200);
  expect((await request.get("/api/me", { headers: { authorization } })).status()).toBe(401);
});

test("denying a device code fails the waiting tool's poll", {
  tag: ["@live", "@live-db"],
}, async ({ page, request }) => {
  const code = await requestDeviceCode(request);
  createdUserCodes.push(code.user_code);

  await page.goto(`/device?user_code=${code.user_code}`);
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("heading", { name: "Denied" })).toBeVisible();

  const tokenResponse = await pollDeviceToken(request, code.device_code);
  expect(tokenResponse.status()).toBe(400);
  expect(await tokenResponse.json()).toMatchObject({ error: "access_denied" });
});

test("an unauthenticated visitor cannot approve anything", {
  tag: ["@live", "@live-db"],
}, async ({ browser, baseURL }: { browser: Browser; baseURL: string | undefined }) => {
  // A fresh context WITHOUT the project's storage state: /device is behind the
  // proxy gate like every other page, so the approval UI is never reachable
  // without a session. A manually created context inherits none of the `use`
  // options, so baseURL is handed over explicitly.
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    await page.goto("/device?user_code=ABCD2345");

    await expect(page).toHaveURL(
      `/sign-in?callbackURL=${encodeURIComponent("/device?user_code=ABCD2345")}`,
    );
  } finally {
    await context.close();
  }
});

test("visiting /device without a code offers nothing to approve", {
  tag: ["@live", "@live-db"],
}, async ({ page }) => {
  await page.goto("/device");

  await expect(page.getByRole("heading", { name: "Nothing to approve" })).toBeVisible();
  await expect(page.getByText("Open the link printed by the command line tool.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});
