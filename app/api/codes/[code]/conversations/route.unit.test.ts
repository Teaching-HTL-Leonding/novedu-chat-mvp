// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The creator-only bearer route for the conversation export: the auth gate
// stays REAL over a stubbed `getSession` while the code lookup, the export store
// and telemetry are mocked. Pins the 401/403 matrix, input validation BEFORE any
// store call, the creator-only 403, the 404/503 mapping and the wire shape.

const mocks = vi.hoisted(() => ({
  getCode: vi.fn(),
  listConversationPage: vi.fn(),
  emitEvent: vi.fn(),
  recordError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/code-store", () => ({ getCode: mocks.getCode }));
vi.mock("@/lib/conversation-export-store", () => ({
  listConversationPage: mocks.listConversationPage,
}));
vi.mock("@/lib/telemetry", () => ({ emitEvent: mocks.emitEvent, recordError: mocks.recordError }));
vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { encodeCursor } from "@/lib/conversation-export";
import { bearerSession } from "@/tests/mock-auth-session";
import { GET } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const CODE = "k7f3qz";
const TEACHER = "teacher-oid-1";

function mint(teacher = true): string {
  getSession.mockResolvedValue(
    bearerSession({ id: TEACHER, name: "Test Teacher", isTeacher: teacher }),
  );
  return "session-token";
}

async function getRequest(query = "", token?: string, code = CODE): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/codes/${code}/conversations${query}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ code }) },
  );
}

const ENTRY = {
  code: CODE,
  module: "tutor" as const,
  createdBy: TEACHER,
  fileUrl: "https://example.test/vektoren.yaml",
  validFrom: null,
  validUntil: null,
  note: "4AHIF Vektoren",
  origin: null,
  anonymous: true,
  llm: null,
  createdAt: new Date("2026-10-01T08:00:00Z"),
};

const CONVERSATION = {
  threadId: "thread-1",
  startedAt: "2026-10-07T09:00:00.000Z",
  endedAt: "2026-10-07T09:01:00.000Z",
  truncated: false,
  messages: [
    { role: "user", createdAt: "2026-10-07T09:00:00.000Z", content: "Hallo" },
    { role: "assistant", createdAt: "2026-10-07T09:01:00.000Z", content: "Hi" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  mocks.getCode.mockResolvedValue(ENTRY);
  mocks.listConversationPage.mockResolvedValue({
    conversations: [CONVERSATION],
    nextCursor: "next",
  });
});

describe("GET /api/codes/[code]/conversations auth", () => {
  it("401s without a token, with WWW-Authenticate and the uniform { message } body", async () => {
    const res = await getRequest();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({ message: "Unauthorized" });
    expect(mocks.getCode).not.toHaveBeenCalled();
  });

  it("403s a non-teacher before any lookup", async () => {
    const res = await getRequest("", mint(false));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Forbidden" });
    expect(mocks.getCode).not.toHaveBeenCalled();
  });

  it("403s a teacher who is not the code's creator, without reading conversations", async () => {
    mocks.getCode.mockResolvedValue({ ...ENTRY, createdBy: "someone-else" });
    const res = await getRequest("", mint());
    expect(res.status).toBe(403);
    expect(await res.json()).toHaveProperty("message");
    expect(mocks.listConversationPage).not.toHaveBeenCalled();
  });
});

describe("GET /api/codes/[code]/conversations input", () => {
  it.each(["0", "51", "abc", "1.5", "-1", "", "1000"])(
    "400s limit=%s before any lookup",
    async (limit) => {
      const res = await getRequest(`?limit=${limit}`, mint());
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty("message");
      expect(mocks.getCode).not.toHaveBeenCalled();
    },
  );

  it("400s a malformed cursor before any lookup", async () => {
    const res = await getRequest("?after=garbage!", mint());
    expect(res.status).toBe(400);
    expect(mocks.getCode).not.toHaveBeenCalled();
  });

  it("defaults limit to 25 and forwards a valid cursor", async () => {
    const after = { createdAt: "2026-10-07T09:00:00.123456", id: "thread-0" };
    await getRequest(`?after=${encodeCursor(after)}`, mint());
    expect(mocks.listConversationPage).toHaveBeenCalledWith(CODE, { after, limit: 25 });
  });

  it("accepts the bounds 1 and 50", async () => {
    await getRequest("?limit=1", mint());
    await getRequest("?limit=50", mint());
    expect(mocks.listConversationPage.mock.calls.map((call) => call[1].limit)).toEqual([1, 50]);
  });
});

describe("GET /api/codes/[code]/conversations lookups", () => {
  it("404s an unknown code", async () => {
    mocks.getCode.mockResolvedValue(null);
    const res = await getRequest("", mint());
    expect(res.status).toBe(404);
    expect(mocks.listConversationPage).not.toHaveBeenCalled();
  });

  it("503s when the code lookup fails", async () => {
    mocks.getCode.mockResolvedValue(undefined);
    expect((await getRequest("", mint())).status).toBe(503);
  });

  it("503s when the store fails", async () => {
    mocks.listConversationPage.mockResolvedValue(undefined);
    const res = await getRequest("", mint());
    expect(res.status).toBe(503);
    expect(await res.json()).toHaveProperty("message");
    expect(mocks.emitEvent).not.toHaveBeenCalled();
  });
});

describe("GET /api/codes/[code]/conversations page", () => {
  it("returns the documented shape, no-store, and a content-free event", async () => {
    const res = await getRequest("?limit=10", mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      code: {
        code: CODE,
        module: "tutor",
        note: "4AHIF Vektoren",
        fileUrl: "https://example.test/vektoren.yaml",
        anonymous: true,
      },
      conversations: [CONVERSATION],
      nextCursor: "next",
    });
    expect(mocks.listConversationPage).toHaveBeenCalledWith(CODE, { after: undefined, limit: 10 });
    expect(mocks.emitEvent).toHaveBeenCalledWith("conversations.export.page", {
      code: CODE,
      limit: 10,
      returned: 1,
    });
  });

  it("sends an empty note as null and carries no creator identity", async () => {
    mocks.getCode.mockResolvedValue({ ...ENTRY, note: "" });
    mocks.listConversationPage.mockResolvedValue({ conversations: [], nextCursor: null });
    const body = await (await getRequest("", mint())).json();
    expect(body.code.note).toBeNull();
    expect(body.nextCursor).toBeNull();
    expect(JSON.stringify(body)).not.toContain(TEACHER);
  });

  it("500s an unexpected error and records it", async () => {
    mocks.listConversationPage.mockRejectedValue(new Error("boom"));
    const res = await getRequest("", mint());
    expect(res.status).toBe(500);
    expect(mocks.recordError).toHaveBeenCalled();
  });
});
