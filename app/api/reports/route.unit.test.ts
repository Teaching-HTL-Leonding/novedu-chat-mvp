// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer route for LISTING reports: the auth gate stays REAL over a stubbed
// `auth.api.getSession` (the lib/api-auth.unit.test.ts strategy), while the
// store behind it is mocked. Pins the 401/403 matrix, the /reports inbox's
// filter parsing (mine default ON, status/reaction/q pass-through), the loud
// 400 on unknown enum values, the 503 mapping, and the wire shape (ISO
// timestamps, reporter identity surfaced).

const mocks = vi.hoisted(() => ({ listReports: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/report-store", () => ({ listReports: mocks.listReports }));

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { unpagedResult } from "@/lib/db/paging";
import { bearerSession } from "@/tests/mock-auth-session";
import { GET } from "./route";

const getSession = vi.mocked(auth.api.getSession);

async function mint(teacher = true): Promise<string> {
  getSession.mockResolvedValue(
    bearerSession({ id: "teacher-oid-1", name: "Test Teacher", isTeacher: teacher }),
  );
  return "session-token";
}

async function getRequest(query = "", token?: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/reports${query}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  );
}

const ROW = {
  id: "22222222-2222-2222-2222-222222222222",
  kind: "quiz-answer" as const,
  code: "a1b2c3d4e5",
  codeNote: "linked lists",
  userId: "student-1",
  displayName: "Alice",
  reaction: "holysh" as const,
  description: "d",
  createdAt: new Date("2026-07-28T09:15:00Z"),
  threadId: null,
  questionId: "q1",
  questionText: "Q",
  answerText: "A",
  feedbackText: "F",
  verdict: "correct" as const,
  hadImages: true,
  resolvedAt: null,
  resolvedBy: null,
};

const WIRE_ROW = {
  id: "22222222-2222-2222-2222-222222222222",
  kind: "quiz-answer",
  code: "a1b2c3d4e5",
  codeNote: "linked lists",
  userId: "student-1",
  displayName: "Alice",
  reaction: "holysh",
  description: "d",
  createdAt: "2026-07-28T09:15:00.000Z",
  threadId: null,
  questionId: "q1",
  questionText: "Q",
  answerText: "A",
  feedbackText: "F",
  verdict: "correct",
  hadImages: true,
  resolvedAt: null,
  resolvedBy: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  mocks.listReports.mockResolvedValue(unpagedResult([ROW]));
});

describe("GET /api/reports auth", () => {
  it("401s without a token, with WWW-Authenticate and the uniform { message } body", async () => {
    const res = await getRequest();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({ message: "Unauthorized" });
    expect(mocks.listReports).not.toHaveBeenCalled();
  });

  it("401s a garbage token", async () => {
    const res = await getRequest("", "not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("403s a valid non-teacher token", async () => {
    const res = await getRequest("", await mint(false));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Forbidden" });
    expect(mocks.listReports).not.toHaveBeenCalled();
  });
});

describe("GET /api/reports filters + defaults", () => {
  it("defaults to open reports on the caller's codes and returns the wire shape", async () => {
    const res = await getRequest("", await mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.listReports).toHaveBeenCalledWith({
      status: "open",
      reaction: undefined,
      search: undefined,
      codeCreatedBy: "teacher-oid-1",
    });
    expect(await res.json()).toEqual([WIRE_ROW]);
  });

  it("widens to all codes with mine=0 and passes status + reaction + q through", async () => {
    await getRequest("?mine=0&status=resolved&reaction=bad&q=%20lists%20", await mint());
    expect(mocks.listReports).toHaveBeenCalledWith({
      status: "resolved",
      reaction: "bad",
      search: "lists",
      codeCreatedBy: undefined,
    });
  });

  it("accepts status=all", async () => {
    await getRequest("?status=all", await mint());
    expect(mocks.listReports).toHaveBeenCalledWith(expect.objectContaining({ status: "all" }));
  });
});

describe("GET /api/reports validation", () => {
  it("400s an unknown status without touching the store (loud, unlike the web UI)", async () => {
    const res = await getRequest("?status=nonsense", await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: expect.stringMatching(/status/i) });
    expect(mocks.listReports).not.toHaveBeenCalled();
  });

  it("400s an unknown reaction without touching the store", async () => {
    const res = await getRequest("?reaction=meh", await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: expect.stringMatching(/reaction/i) });
    expect(mocks.listReports).not.toHaveBeenCalled();
  });
});

describe("GET /api/reports store errors", () => {
  it("503s when the store is unreachable", async () => {
    mocks.listReports.mockResolvedValue(undefined);
    const res = await getRequest("", await mint());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ message: expect.stringMatching(/try again/i) });
  });
});
