import { describe, expect, it, vi } from "vitest";
import { DEMO_AUTH_ENDPOINTS, demoAuthAllows, demoAuthPath } from "@/lib/auth-demo-allowlist";

// The demo build's /api/auth allowlist (docs/auth.md, "Demo mode"): the personas are
// shared, so every endpoint touching a user's own account or sessions stays closed.

vi.mock("server-only", () => ({}));

const request = (method: string, path: string) =>
  new Request(`http://localhost:3000${path}`, { method });

describe("demoAuthPath", () => {
  it.each([
    ["/api/auth/sign-in/email", "/sign-in/email"],
    ["/api/auth/sign-in/email/", "/sign-in/email"],
    ["/api/auth/sign-in/email//", "/sign-in/email"],
    ["/api/auth", "/"],
    ["/api/auth/", "/"],
    ["/api/auth/device/token?x=1", "/device/token"],
  ])("%s → %s", (path, expected) => {
    expect(demoAuthPath(`http://localhost:3000${path}`)).toBe(expected);
  });
});

describe("demoAuthAllows", () => {
  it.each([
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/sign-in/email/"],
    ["POST", "/api/auth/sign-out"],
    ["GET", "/api/auth/get-session"],
    ["POST", "/api/auth/device/code"],
    ["POST", "/api/auth/device/token"],
  ])("serves %s %s", (method, path) => {
    expect(demoAuthAllows(request(method, path))).toBe(true);
  });

  it.each([
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/change-password"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/revoke-sessions"],
    ["POST", "/api/auth/sign-in/social"],
    ["POST", "/api/auth/device/approve"],
    ["GET", "/api/auth/device"],
    ["GET", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/get-session"],
    ["POST", "/api/auth/sign-in/email/extra"],
    ["POST", "/api/auth/sign-in/EMAIL"],
  ])("404s %s %s", (method, path) => {
    expect(demoAuthAllows(request(method, path))).toBe(false);
  });
});

// Every HTTP endpoint the installed better-auth exposes on THIS instance, each
// reviewed for a demo build. A better-auth bump (or a new plugin) that adds an
// endpoint fails here until someone classifies it — closed until reviewed.
const REVIEWED_CLOSED = new Set([
  "/sign-in/social",
  "/callback/:id",
  "/sign-up/email",
  "/reset-password",
  "/verify-password",
  "/verify-email",
  "/send-verification-email",
  "/change-email",
  "/change-password",
  "/update-session",
  "/update-user",
  "/delete-user",
  "/request-password-reset",
  "/reset-password/:token",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/link-social",
  "/list-accounts",
  "/delete-user/callback",
  "/unlink-account",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
  // Viewing, approving and denying a device code run server-side on /device.
  "/device",
  "/device/approve",
  "/device/deny",
  "/ok",
  "/error",
]);

describe("the installed better-auth's endpoints", () => {
  it("are each either on the allowlist or reviewed as closed", async () => {
    vi.stubEnv("NOVEDU_AUTH_MODE", "demo");
    for (const name of ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID"]) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("TEACHER_GROUP_ID", "");
    vi.stubEnv("AUTH_URL", "");
    // The pool never connects: building the instance runs no query.
    vi.stubEnv("DATABASE_URL", "postgresql://unit:placeholder@localhost:5432/unit");
    const { auth } = await import("@/auth");

    const paths = Object.values(auth.api as Record<string, { path?: string }>)
      .map((endpoint) => endpoint.path)
      .filter((path): path is string => typeof path === "string");
    const allowed = new Set([...DEMO_AUTH_ENDPOINTS].map((entry) => entry.split(" ")[1]));

    expect(paths.filter((path) => !allowed.has(path) && !REVIEWED_CLOSED.has(path))).toEqual([]);
    // Positive control: every allowlisted path is a real endpoint of this instance.
    expect([...allowed].filter((path) => !paths.includes(path ?? ""))).toEqual([]);
  });
});
