import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { DEMO_PASSWORD, DEMO_PERSONAS } from "../lib/demo-personas";
import { watchErrors } from "./page.utils";

// @demo: a demo build's sign-in (docs/auth.md, "Demo mode"), run ONLY against a
// demo production build (playwright.config.ts picks the suite by mode). The
// personas are seeded by the server's own boot; every sign-in here goes through
// the real email sign-in, the real production rate limit and the real allowlist.

const ORIGIN = { origin: "http://localhost:3000" };
const [ANNA, , MIA] = DEMO_PERSONAS;
if (!ANNA || !MIA) throw new Error("demo personas missing");

const ribbon = (page: Page) => page.getByRole("complementary", { name: "Environment" });

async function signInByApi(request: APIRequestContext, email: string) {
  return request.post("/api/auth/sign-in/email", {
    headers: ORIGIN,
    data: { email, password: DEMO_PASSWORD },
  });
}

test("the demo sign-in page opens without errors and says what it is", {
  tag: "@demo",
}, async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/sign-in");

  await expect(page.getByRole("heading", { name: "Sign in as a demo person" })).toBeVisible();
  await expect(page.getByText(/anyone who can open this page can sign in/)).toBeVisible();
  for (const persona of DEMO_PERSONAS) {
    await expect(
      page.getByRole("button", { name: new RegExp(`^${persona.name} · `) }),
    ).toBeEnabled();
  }
  await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toHaveCount(0);
  // The DEMO ribbon is in the server HTML and cannot be hidden.
  await expect(ribbon(page)).toContainText("DEMO");
  await expect(ribbon(page).getByRole("button")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a teacher persona signs in to the teacher home and signs out again", {
  tag: "@demo",
}, async ({ page }) => {
  await page.goto("/sign-in?callbackURL=%2F");
  await page.getByRole("button", { name: "Anna Berger · Teacher" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back, Anna" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Teacher" })).toBeVisible();
  await expect(ribbon(page)).toContainText("DEMO");

  await page.getByRole("button", { name: /Anna Berger/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in as a demo person" })).toBeVisible();
});

test("a student persona signs in to the student home", { tag: "@demo" }, async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Mia Gruber · Student" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: /Mia/ })).toBeVisible();
  await expect(page.getByLabel("Code")).toBeVisible();
  await expect(page.getByRole("img", { name: "Teacher" })).toHaveCount(0);
});

test("the shared personas' account and session endpoints are closed", {
  tag: "@demo",
}, async ({ request }) => {
  expect((await signInByApi(request, ANNA.email)).status()).toBe(200);
  // Signed in, with a valid origin and a well-formed body: a 404 here is the
  // allowlist, not an incidental 400/401 from better-auth.
  const calls: [string, string, object | undefined][] = [
    [
      "POST",
      "/api/auth/change-password",
      { currentPassword: DEMO_PASSWORD, newPassword: "x".repeat(12) },
    ],
    [
      "POST",
      "/api/auth/sign-up/email",
      { email: "new@demo.novedu.invalid", password: "x".repeat(12), name: "New" },
    ],
    ["GET", "/api/auth/list-sessions", undefined],
    ["POST", "/api/auth/revoke-sessions", {}],
    ["POST", "/api/auth/update-user", { name: "Mallory" }],
  ];
  for (const [method, path, data] of calls) {
    const response = await request.fetch(path, { method, headers: ORIGIN, data });
    expect(response.status(), `${method} ${path}`).toBe(404);
  }
  const session = await request.get("/api/auth/get-session");
  expect((await session.json()).user.id).toBe(ANNA.id);
});

test("a class can sign in in quick succession from one address", {
  tag: "@demo",
}, async ({ request }) => {
  // better-auth's production default would allow 3 per 10 s per IP.
  const statuses = await Promise.all(
    Array.from({ length: 8 }, () => signInByApi(request, MIA.email).then((r) => r.status())),
  );
  expect(statuses).toEqual(Array(8).fill(200));
});

test("the CLI device flow signs a persona in", { tag: "@demo" }, async ({ page, request }) => {
  const codeResponse = await request.post("/api/auth/device/code", {
    headers: ORIGIN,
    data: { client_id: "novedu-cli" },
  });
  expect(codeResponse.status()).toBe(200);
  const code = await codeResponse.json();

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Anna Berger · Teacher" }).click();
  await expect(page).toHaveURL("/");
  await page.goto(`/device?user_code=${code.user_code}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();

  const token = await request.post("/api/auth/device/token", {
    headers: ORIGIN,
    data: {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: code.device_code,
      client_id: "novedu-cli",
    },
  });
  expect(token.status()).toBe(200);
  const authorization = `Bearer ${(await token.json()).access_token}`;

  const me = await request.get("/api/me", { headers: { authorization } });
  expect(me.status()).toBe(200);
  expect(await me.json()).toEqual({ name: ANNA.name, userId: ANNA.id, isTeacher: true });

  // What `novedu logout` does — on the allowlist, and leaves no live CLI session.
  const signOut = await request.post("/api/auth/sign-out", {
    headers: { authorization, "content-type": "application/json", ...ORIGIN },
    data: {},
  });
  expect(signOut.status()).toBe(200);
  expect((await request.get("/api/me", { headers: { authorization } })).status()).toBe(401);
});
