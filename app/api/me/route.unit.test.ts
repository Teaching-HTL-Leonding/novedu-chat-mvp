// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer identity probe: real auth gate over a stubbed `getSession`. Pins the
// wire shape and the channel conventions every bearer handler shares (docs/api.md):
// `Cache-Control: no-store` on success AND failure, `{ message }` failure bodies,
// and `WWW-Authenticate: Bearer` on a 401.

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { bearerSession } from "@/tests/mock-auth-session";
import { GET } from "./route";

const getSession = vi.mocked(auth.api.getSession);

function getRequest(token?: string): Request {
  return new Request("http://localhost/api/me", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  getSession.mockReset();
});

describe("GET /api/me", () => {
  it("returns the caller's identity, uncached", async () => {
    getSession.mockResolvedValue(bearerSession({ id: "u1", name: "Ada", isTeacher: true }));
    const res = await GET(getRequest("token-u1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ name: "Ada", userId: "u1", isTeacher: true });
  });

  it("answers a missing token with an uncached generic 401", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(Object.keys(await res.json())).toEqual(["message"]);
  });

  it("answers a dead session with an uncached generic 401", async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(getRequest("stale"));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
