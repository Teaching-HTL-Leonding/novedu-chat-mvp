// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer route for bulk-RESOLVING reports: the auth gate stays REAL over a
// stubbed `getSession` while the store is mocked. Pins the 401/403 matrix, the
// 400 on a malformed/empty ids body, the 503 mapping, the 200 success body, and
// that the token oid is passed through as the resolving teacher (resolved_by).

const mocks = vi.hoisted(() => ({ setReportsResolved: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/report-store", () => ({ setReportsResolved: mocks.setReportsResolved }));

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { bearerSession } from "@/tests/mock-auth-session";
import { POST } from "./route";

const getSession = vi.mocked(auth.api.getSession);

const ID_1 = "22222222-2222-2222-2222-222222222222";
const ID_2 = "33333333-3333-3333-3333-333333333333";

async function mint(teacher = true): Promise<string> {
  getSession.mockResolvedValue(
    bearerSession({ id: "teacher-oid-1", name: "Test Teacher", isTeacher: teacher }),
  );
  return "session-token";
}

async function postRequest(body: unknown, token?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/reports/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  mocks.setReportsResolved.mockResolvedValue(true);
});

describe("POST /api/reports/resolve auth", () => {
  it("401s without a token and 403s a non-teacher, never touching the store", async () => {
    expect((await postRequest({ ids: [ID_1] })).status).toBe(401);
    expect((await postRequest({ ids: [ID_1] }, await mint(false))).status).toBe(403);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });
});

describe("POST /api/reports/resolve validation", () => {
  it("400s a non-JSON body", async () => {
    const res = await postRequest("{not json", await mint());
    expect(res.status).toBe(400);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });

  it("400s an empty ids array", async () => {
    const res = await postRequest({ ids: [] }, await mint());
    expect(res.status).toBe(400);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });

  it("400s a non-UUID entry in ids", async () => {
    const res = await postRequest({ ids: [ID_1, "nope"] }, await mint());
    expect(res.status).toBe(400);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });

  it("400s a missing ids field", async () => {
    const res = await postRequest({}, await mint());
    expect(res.status).toBe(400);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });
});

describe("POST /api/reports/resolve success + errors", () => {
  it("resolves all ids under the token oid and returns { ok: true }", async () => {
    const res = await postRequest({ ids: [ID_1, ID_2] }, await mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    // resolved = true, teacherId = the token oid (resolved_by attribution).
    expect(mocks.setReportsResolved).toHaveBeenCalledWith([ID_1, ID_2], true, "teacher-oid-1");
  });

  it("503s when the store update fails", async () => {
    mocks.setReportsResolved.mockResolvedValue(false);
    const res = await postRequest({ ids: [ID_1] }, await mint());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ message: expect.stringMatching(/try again/i) });
  });
});
