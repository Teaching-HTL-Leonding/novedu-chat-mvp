// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer route for ONE report's detail: the auth gate stays REAL over a
// stubbed `getSession` while the store + the reused transcript reader are
// mocked. Pins the 401/403 matrix, the 404 on a malformed/unknown id, the 503
// mapping (store + transcript), and the wire shapes — a chat report embeds the
// projected `messages`, a quiz report does NOT, and a deleted-code chat report
// embeds `[]`.

const mocks = vi.hoisted(() => ({
  getReportById: vi.fn(),
  getConversationMessages: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/report-store", () => ({ getReportById: mocks.getReportById }));
vi.mock("@/lib/code-stats-store", () => ({
  getConversationMessages: mocks.getConversationMessages,
}));

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { bearerSession } from "@/tests/mock-auth-session";
import { GET } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const REPORT_ID = "22222222-2222-2222-2222-222222222222";

async function mint(teacher = true): Promise<string> {
  getSession.mockResolvedValue(
    bearerSession({ id: "teacher-oid-1", name: "Test Teacher", isTeacher: teacher }),
  );
  return "session-token";
}

async function getRequest(id: string, token?: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/reports/${id}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ id }) },
  );
}

const CHAT_ROW = {
  id: REPORT_ID,
  kind: "chat" as const,
  code: "a1b2c3d4e5",
  codeNote: "linked lists",
  userId: "student-1",
  displayName: "Alice",
  reaction: "bad" as const,
  description: "d",
  createdAt: new Date("2026-07-28T09:15:00Z"),
  threadId: "thread-1",
  questionId: null,
  questionText: null,
  answerText: null,
  feedbackText: null,
  verdict: null,
  hadImages: false,
  resolvedAt: null,
  resolvedBy: null,
};

const QUIZ_ROW = {
  ...CHAT_ROW,
  kind: "quiz-answer" as const,
  reaction: "holysh" as const,
  threadId: null,
  questionId: "q1",
  questionText: "Q",
  answerText: "A",
  feedbackText: "F",
  verdict: "correct" as const,
  hadImages: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  mocks.getReportById.mockResolvedValue(CHAT_ROW);
  mocks.getConversationMessages.mockResolvedValue([
    { id: "m1", role: "user", content: "hello" },
    { id: "m2", role: "assistant", content: "hi there" },
  ]);
});

describe("GET /api/reports/[id] auth", () => {
  it("401s without a token, with WWW-Authenticate and the uniform { message } body", async () => {
    const res = await getRequest(REPORT_ID);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({ message: "Unauthorized" });
    expect(mocks.getReportById).not.toHaveBeenCalled();
  });

  it("403s a valid non-teacher token", async () => {
    const res = await getRequest(REPORT_ID, await mint(false));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Forbidden" });
    expect(mocks.getReportById).not.toHaveBeenCalled();
  });
});

describe("GET /api/reports/[id] not-found + errors", () => {
  it("404s a malformed (non-UUID) id without touching the store", async () => {
    const res = await getRequest("not-a-uuid", await mint());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ message: expect.any(String) });
    expect(mocks.getReportById).not.toHaveBeenCalled();
  });

  it("404s an unknown id (store returns null)", async () => {
    mocks.getReportById.mockResolvedValue(null);
    const res = await getRequest(REPORT_ID, await mint());
    expect(res.status).toBe(404);
  });

  it("503s when the store errors (undefined)", async () => {
    mocks.getReportById.mockResolvedValue(undefined);
    const res = await getRequest(REPORT_ID, await mint());
    expect(res.status).toBe(503);
  });

  it("503s when the transcript read errors (undefined) for a chat report", async () => {
    mocks.getConversationMessages.mockResolvedValue(undefined);
    const res = await getRequest(REPORT_ID, await mint());
    expect(res.status).toBe(503);
  });
});

describe("GET /api/reports/[id] wire shapes", () => {
  it("embeds the projected transcript for a chat report", async () => {
    const res = await getRequest(REPORT_ID, await mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getConversationMessages).toHaveBeenCalledWith("a1b2c3d4e5", "thread-1");
    const body = await res.json();
    expect(body).toMatchObject({
      id: REPORT_ID,
      kind: "chat",
      createdAt: "2026-07-28T09:15:00.000Z",
      threadId: "thread-1",
      messages: [
        { id: "m1", role: "user", content: "hello" },
        { id: "m2", role: "assistant", content: "hi there" },
      ],
    });
  });

  it("projects mixed content to text and omits image-only messages", async () => {
    mocks.getConversationMessages.mockResolvedValue([
      {
        id: "m1",
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", source: { type: "url", value: "data:image/png;base64,AAA" } },
        ],
      },
      // Image-only message → no text → omitted.
      {
        id: "m2",
        role: "user",
        content: [{ type: "image", source: { type: "url", value: "data:image/png;base64,BBB" } }],
      },
      { id: "m3", role: "assistant", content: "nice" },
    ]);
    const body = await (await getRequest(REPORT_ID, await mint())).json();
    expect(body.messages).toEqual([
      { id: "m1", role: "user", content: "look at this" },
      { id: "m3", role: "assistant", content: "nice" },
    ]);
  });

  it("returns messages: [] for a chat report whose code/thread was deleted", async () => {
    mocks.getConversationMessages.mockResolvedValue([]);
    const body = await (await getRequest(REPORT_ID, await mint())).json();
    expect(body.messages).toEqual([]);
  });

  it("has NO messages key for a quiz-answer report and never reads a transcript", async () => {
    mocks.getReportById.mockResolvedValue(QUIZ_ROW);
    const body = await (await getRequest(REPORT_ID, await mint())).json();
    expect(body).not.toHaveProperty("messages");
    expect(body).toMatchObject({ kind: "quiz-answer", questionText: "Q", verdict: "correct" });
    expect(mocks.getConversationMessages).not.toHaveBeenCalled();
  });
});
