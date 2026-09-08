import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { COOKIE_NAME } from "./auth.constants";
import { sessionCookieValue } from "./session-cookie";

// The app's ONE public page (besides the teacher guide): everything the proxy
// bounces lands here. Cookie-free on purpose — with the project's minted session
// state the redirect under test would never happen.
test.use({ storageState: { cookies: [], origins: [] } });

/** AUTH_SECRET, read from `.env` the way `auth.setup.ts` does. */
function authSecret(): string {
  loadEnvConfig(process.cwd());
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing — cannot sign a session cookie.");
  return secret;
}

test("the sign-in page offers the Microsoft sign-in", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeEnabled();

  // The screen renders without the app chrome: no burger to open a navigation
  // nobody signed out can use, and no second sign-in control in a status bar.
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("a gated page bounces here carrying where it wanted to go", async ({ page }) => {
  await page.goto("/codes");

  await expect(page).toHaveURL("/sign-in?callbackURL=%2Fcodes");
  await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();
});

test("a cookie the server cannot resolve lands on a page offering sign-in", async ({
  page,
  context,
}) => {
  // The gate only checks that a session cookie is PRESENT, so both shapes it
  // cannot tell apart — garbage, and a genuine cookie whose session row is gone —
  // reach the page. `getSession()` resolves nothing, and the status bar is what
  // gets the visitor back to /sign-in (docs/auth.md).
  const token = randomBytes(24).toString("base64url");
  for (const value of ["garbage.garbage", await sessionCookieValue(token, authSecret())]) {
    await context.clearCookies();
    await context.addCookies([{ name: COOKIE_NAME, value, domain: "localhost", path: "/" }]);

    await page.goto("/");

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    // No user menu: nothing to open, nothing to sign out of.
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toHaveCount(0);
  }
});

test("an absolute callbackURL is never handed to the sign-in flow", async ({ page }) => {
  // Open-redirect guard: only an app-relative path may reach better-auth's
  // `callbackURL`. The server component replaces anything else with "/" before
  // the value reaches the button, so what the sign-in request actually carries
  // is the assertion that matters — the raw query string unavoidably shows up
  // in Next's own router payload, which proves nothing either way.
  //
  // The request is stubbed out so the test never leaves the app (a real one
  // would redirect to Microsoft).
  let posted: { callbackURL?: string } | null = null;
  await page.route("**/api/auth/sign-in/**", async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "/", redirect: false }),
    });
  });

  await page.goto("/sign-in?callbackURL=https://evil.example");
  await page.getByRole("button", { name: "Sign in with Microsoft" }).click();

  await expect.poll(() => posted).not.toBeNull();
  expect(posted).toMatchObject({ provider: "microsoft", callbackURL: "/" });
});
