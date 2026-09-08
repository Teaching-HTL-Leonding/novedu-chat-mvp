// @vitest-environment node
// This module is server-only (it pulls in the auth instance); the node realm is
// the one it actually runs in.
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer gate over a stubbed `auth.api.getSession`: the auth instance itself
// needs a database and Entra credentials, so the session lookup is the seam.
// What is pinned here is everything AROUND it — the header parsing, the
// cookie-can-never-authenticate rule, and the mapping onto `BearerUser`.
vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { ApiAuthError, requireBearerTeacher, requireBearerUser } from "@/lib/api-auth";

const getSession = vi.mocked(auth.api.getSession);

function session({ isTeacher = false }: { isTeacher?: boolean } = {}) {
  return {
    session: { id: "s1", token: "tok", userId: "user-1" },
    user: { id: "user-1", name: "Test User", email: "test@example.com", isTeacher },
  } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>;
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/me", { headers });
}

async function expectRejection(promise: Promise<unknown>, status: 401 | 403): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error("expected the request to be rejected");
    },
    (e) => e,
  );
  expect(error).toBeInstanceOf(ApiAuthError);
  expect((error as ApiAuthError).status).toBe(status);
}

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
});

describe("requireBearerUser", () => {
  it("returns the caller for a token that resolves to a session", async () => {
    getSession.mockResolvedValue(session());

    const user = await requireBearerUser(request({ authorization: "Bearer session-token" }));

    expect(user).toEqual({ userId: "user-1", name: "Test User", isTeacher: false });
  });

  it("carries the teacher flag from the session user", async () => {
    getSession.mockResolvedValue(session({ isTeacher: true }));

    const user = await requireBearerUser(request({ authorization: "Bearer session-token" }));

    expect(user.isTeacher).toBe(true);
  });

  it("rejects a missing Authorization header with 401 without asking for a session", async () => {
    await expectRejection(requireBearerUser(request()), 401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-bearer scheme", "Basic dXNlcjpwdw=="],
    ["a bearer header without a token", "Bearer "],
  ])("rejects %s with 401 without asking for a session", async (_label, header) => {
    await expectRejection(requireBearerUser(request({ authorization: header })), 401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("rejects a token that matches no live session with 401", async () => {
    await expectRejection(
      requireBearerUser(request({ authorization: "Bearer stale-or-garbage" })),
      401,
    );
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("rejects a cookie-only request with 401 and never looks up a session", async () => {
    // The CSRF shape: a signed-in teacher's browser is made to call an API
    // route. It carries a cookie but no bearer, and must not authenticate.
    getSession.mockResolvedValue(session({ isTeacher: true }));

    await expectRejection(
      requireBearerUser(request({ cookie: "novedu.session_token=tok.sig" })),
      401,
    );
    expect(getSession).not.toHaveBeenCalled();
  });

  it("forwards ONLY the authorization header, never the request's cookie", async () => {
    getSession.mockResolvedValue(session());

    await requireBearerUser(
      request({
        authorization: "Bearer session-token",
        cookie: "novedu.session_token=someone-elses.sig",
      }),
    );

    const forwarded = getSession.mock.calls[0]?.[0]?.headers as Headers;
    expect(forwarded.get("authorization")).toBe("Bearer session-token");
    expect(forwarded.get("cookie")).toBeNull();
    expect([...forwarded.keys()]).toEqual(["authorization"]);
  });
});

describe("requireBearerTeacher", () => {
  it("returns the user for a teacher session", async () => {
    getSession.mockResolvedValue(session({ isTeacher: true }));

    const user = await requireBearerTeacher(request({ authorization: "Bearer session-token" }));

    expect(user.isTeacher).toBe(true);
  });

  it("rejects a valid non-teacher session with 403", async () => {
    getSession.mockResolvedValue(session());

    await expectRejection(
      requireBearerTeacher(request({ authorization: "Bearer session-token" })),
      403,
    );
  });

  it("rejects an unusable token with 401 (not 403)", async () => {
    await expectRejection(requireBearerTeacher(request({ authorization: "Bearer nope" })), 401);
  });
});
