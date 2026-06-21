// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// The chat runtime route gates every DATA request (run/connect/stop) with three
// server-side checks (auth → tutor code → thread-ownership token) before it ever
// builds the Mastra runtime. GET `/info` is the exception: metadata only, gated
// by AUTH ALONE (the read-only conversation viewer needs it without a code).
// Those checks are the security boundary, and they all short-circuit with a
// 401/403/404 — so they can be exercised fast, with no DB and no LLM, by mocking
// only the I/O seams and driving real `Request`s through the handler.
//
// What is REAL here: `classifyRequest` (the endpoint allowlist) and the
// thread-token HMAC (`lib/thread-token.ts`). What is mocked: the session, the
// tutor-code lookup, and everything downstream of a passed gate (the CopilotKit
// runtime, the Mastra agent factory, the attribution write). This replaces
// e2e/thread-ownership.spec.ts and the backend-403 half of
// e2e/share-window-expiry.spec.ts, neither of which could run in CI.

const auth = vi.hoisted(() => vi.fn());
const checkTutorCode = vi.hoisted(() => vi.fn());
const recordUserChat = vi.hoisted(() => vi.fn());
const recordQuizChat = vi.hoisted(() => vi.fn());
const loadQuiz = vi.hoisted(() => vi.fn());
const getLocalAgents = vi.hoisted(() => vi.fn(() => []));
const endpointFetch = vi.hoisted(() =>
  vi.fn(async (_req: Request) => new Response("{}", { status: 200 })),
);

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/tutor-code-store", () => ({ checkTutorCode }));
vi.mock("@/lib/user-chat-store", () => ({ recordUserChat, recordQuizChat }));
// Mock the quiz LOADER (DB/network) but keep the quiz-LINK HMAC real, like the
// thread token — the signature check is the security boundary under test.
vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz }));
// Importing the real Mastra instance would pull in @mastra/mssql + the Azure
// credential chain; the handler only passes it through to getLocalAgents.
vi.mock("@/app/mastra", () => ({ mastra: {} }));
// after() needs a Next request scope; the happy-path tests don't assert the
// scheduled attribution, so a no-op keeps them in the plain node env.
vi.mock("next/server", () => ({ after: vi.fn() }));
// Stub everything past the gate so a passed request returns deterministically
// without a real runtime, agent, or model.
vi.mock("@ag-ui/mastra", () => ({ MastraAgent: { getLocalAgents } }));
vi.mock("@copilotkit/runtime/v2", () => ({
  CopilotRuntime: vi.fn(),
  createCopilotEndpoint: () => ({ fetch: endpointFetch }),
}));
vi.mock("@mastra/core/request-context", () => ({
  RequestContext: class {
    set() {}
  },
}));

// AUTH_SECRET must exist before the thread-token secret is first derived; the
// thread-token module is REAL and memoizes it, so reset between tests.
process.env.AUTH_SECRET = "test-secret-for-route-unit";

import { getQuizLinkSecret, resetQuizLinkSecretForTests, signQuizPayload } from "@/lib/quiz-link";
import {
  getThreadTokenSecret,
  resetThreadTokenSecretForTests,
  signThreadToken,
} from "@/lib/thread-token";
import { GET, POST, trimToNewTurn } from "./route";

const CODE = "a1b2c3d4e5";
const USER_ID = "user-1";
const BASE = "http://localhost/api/copilotkit";

function runBody(threadId: string | undefined, messages: unknown[] = []) {
  return JSON.stringify({
    ...(threadId === undefined ? {} : { threadId }),
    runId: "r1",
    messages,
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  });
}

function runRequest(
  opts: { threadId?: string; token?: string; code?: string; messages?: unknown[] } = {},
) {
  const headers: Record<string, string> = {
    "x-tutor-code": opts.code ?? CODE,
    "content-type": "application/json",
  };
  if (opts.token !== undefined) headers["x-thread-token"] = opts.token;
  return new Request(`${BASE}/agent/tutor/run`, {
    method: "POST",
    headers,
    body: runBody(opts.threadId, opts.messages),
  });
}

// A signed quiz link reused by the quiz-branch tests. The window is wide enough
// to always contain "now"; the secret is the real AUTH_SECRET-derived one.
const QUIZ_URL = "https://example.com/api/files/q";
const QUIZ_START = 1000;
const QUIZ_END = 9_999_999_999;

function quizRunRequest(
  opts: { threadId?: string; token?: string; agent?: string; sig?: string } = {},
) {
  const sig =
    opts.sig ??
    signQuizPayload({ quiz: QUIZ_URL, start: QUIZ_START, end: QUIZ_END }, getQuizLinkSecret());
  const headers: Record<string, string> = {
    "x-quiz-url": QUIZ_URL,
    "x-quiz-start": String(QUIZ_START),
    "x-quiz-end": String(QUIZ_END),
    "x-quiz-sig": sig,
    "content-type": "application/json",
  };
  if (opts.token !== undefined) headers["x-thread-token"] = opts.token;
  return new Request(`${BASE}/agent/${opts.agent ?? "quizDiscussion"}/run`, {
    method: "POST",
    headers,
    body: runBody(opts.threadId),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetThreadTokenSecretForTests();
  resetQuizLinkSecretForTests();
  // Default: an authenticated student with a valid code. Individual tests
  // override as needed.
  auth.mockResolvedValue({ user: { id: USER_ID } });
  checkTutorCode.mockResolvedValue({ ok: true, entry: { tutorUrl: "https://example.com/t.yaml" } });
  loadQuiz.mockResolvedValue({
    ok: true,
    quiz: {
      model: "m",
      anonymous: true,
      questions: [{ id: "q1", question: "Q", evaluation: "E" }],
    },
  });
  getLocalAgents.mockReturnValue([]);
  endpointFetch.mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("authentication gate", () => {
  it("401s a request without a session user", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(runRequest({ threadId: crypto.randomUUID() }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });
});

describe("tutor-code gate (re-checked on every data request)", () => {
  it("403s an unknown code with a human-readable message", async () => {
    checkTutorCode.mockResolvedValue({ ok: false, reason: "unknown-code" });
    // A data endpoint (run) — that is what the code gate protects now.
    const res = await POST(runRequest({ threadId: crypto.randomUUID() }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/requires a valid tutor code/i);
  });

  it("403s an expired code — the per-request window re-check (mid-session close)", async () => {
    checkTutorCode.mockResolvedValue({
      ok: false,
      reason: "expired",
      validFrom: new Date("2026-06-10T10:00:00Z"),
      validUntil: new Date("2026-06-10T11:00:00Z"),
    });
    const res = await POST(runRequest({ threadId: crypto.randomUUID() }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/availability window has ended/i);
  });
});

describe("endpoint allowlist (classifyRequest)", () => {
  it("404s the runtime's thread-listing endpoint", async () => {
    const res = await GET(new Request(`${BASE}/threads`, { headers: { "x-tutor-code": CODE } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("404s the runtime's thread-messages endpoint", async () => {
    const res = await GET(
      new Request(`${BASE}/threads/${crypto.randomUUID()}/messages`, {
        headers: { "x-tutor-code": CODE },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("404s an unknown sub-path", async () => {
    const res = await POST(
      new Request(`${BASE}/agent/tutor/bogus`, {
        method: "POST",
        headers: { "x-tutor-code": CODE, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("thread-ownership token (real HMAC)", () => {
  it("403s a run with a bogus token", async () => {
    const res = await POST(runRequest({ threadId: crypto.randomUUID(), token: "deadbeef" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/does not belong to your session/i);
  });

  it("403s a run with no token at all", async () => {
    const res = await POST(runRequest({ threadId: crypto.randomUUID() }));
    expect(res.status).toBe(403);
  });

  it("403s a run whose body carries no threadId", async () => {
    const token = signThreadToken(
      { code: CODE, userId: USER_ID, threadId: "x" },
      getThreadTokenSecret(),
    );
    const res = await POST(runRequest({ token }));
    expect(res.status).toBe(403);
  });

  it("403s a run whose token was signed for a different user", async () => {
    const threadId = crypto.randomUUID();
    const token = signThreadToken(
      { code: CODE, userId: "someone-else", threadId },
      getThreadTokenSecret(),
    );
    const res = await POST(runRequest({ threadId, token }));
    expect(res.status).toBe(403);
  });
});

describe("info endpoint (auth-only metadata)", () => {
  it("serves GET /info with auth alone — no tutor code, no code check", async () => {
    // The read-only conversation viewer mounts a CopilotKitProvider that pings
    // /info but sends no x-tutor-code. It must NOT 403, must not consult the
    // code store, and must run on the placeholder resourceId (no agent runs).
    const res = await GET(new Request(`${BASE}/info`));
    expect(res.status).toBe(200);
    expect(endpointFetch).toHaveBeenCalledOnce();
    expect(checkTutorCode).not.toHaveBeenCalled();
    expect(getLocalAgents).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "__info__" }),
    );
  });

  it("401s GET /info without a session (auth still required)", async () => {
    auth.mockResolvedValue(null);
    const res = await GET(new Request(`${BASE}/info`));
    expect(res.status).toBe(401);
  });
});

describe("happy path past the gate", () => {
  it("forwards a run carrying a correctly-signed token", async () => {
    const threadId = crypto.randomUUID();
    const token = signThreadToken(
      { code: CODE, userId: USER_ID, threadId },
      getThreadTokenSecret(),
    );
    const res = await POST(runRequest({ threadId, token }));
    expect(res.status).toBe(200);
    expect(getLocalAgents).toHaveBeenCalledWith(expect.objectContaining({ resourceId: CODE }));
  });
});

describe("quiz discussion branch (signed link + thread token)", () => {
  function quizToken(threadId: string, code = QUIZ_URL, userId = USER_ID) {
    return signThreadToken({ code, userId, threadId }, getThreadTokenSecret());
  }

  it("forwards a discussion run with a valid link + token, scoped to the quiz URL", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(quizRunRequest({ threadId, token: quizToken(threadId) }));
    expect(res.status).toBe(200);
    expect(getLocalAgents).toHaveBeenCalledWith(expect.objectContaining({ resourceId: QUIZ_URL }));
    // The grader is never consulted by the discussion branch.
    expect(checkTutorCode).not.toHaveBeenCalled();
  });

  it("404s a quiz request targeting the quizEvaluator agent (grader is never web-reachable)", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(
      quizRunRequest({ threadId, token: quizToken(threadId), agent: "quizEvaluator" }),
    );
    expect(res.status).toBe(404);
    expect(getLocalAgents).not.toHaveBeenCalled();
  });

  it("403s a tampered quiz-link signature", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(
      quizRunRequest({ threadId, token: quizToken(threadId), sig: "deadbeef" }),
    );
    expect(res.status).toBe(403);
  });

  it("403s a thread token bound to a tutor code rather than the quiz URL", async () => {
    const threadId = crypto.randomUUID();
    // Token signed with a tutor-style code, not the quiz URL → ownership fails.
    const res = await POST(quizRunRequest({ threadId, token: quizToken(threadId, CODE) }));
    expect(res.status).toBe(403);
  });
});

describe("tutor branch agent gating", () => {
  it("404s a tutor-code request targeting a non-tutor agent", async () => {
    const threadId = crypto.randomUUID();
    const token = signThreadToken(
      { code: CODE, userId: USER_ID, threadId },
      getThreadTokenSecret(),
    );
    const res = await POST(
      new Request(`${BASE}/agent/quizEvaluator/run`, {
        method: "POST",
        headers: {
          "x-tutor-code": CODE,
          "x-thread-token": token,
          "content-type": "application/json",
        },
        body: runBody(threadId),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("trimToNewTurn (replayed-history trimming)", () => {
  it("keeps the turn after the last assistant reply, dropping the replayed prefix", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3 — the new turn" },
    ];
    expect(trimToNewTurn(messages)).toEqual([{ role: "user", content: "u3 — the new turn" }]);
  });

  it("passes the first turn through unchanged (no assistant message yet)", () => {
    const messages = [{ role: "user", content: "first message" }];
    // Same array reference back == 'no trim needed'.
    expect(trimToNewTurn(messages)).toBe(messages);
  });

  it("does not trim to empty when the history ends with an assistant message", () => {
    const messages = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ];
    expect(trimToNewTurn(messages)).toBe(messages);
  });

  it("forwards a run with only the new turn in its body", async () => {
    const threadId = crypto.randomUUID();
    const token = signThreadToken(
      { code: CODE, userId: USER_ID, threadId },
      getThreadTokenSecret(),
    );
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "the new turn" },
    ];
    const res = await POST(runRequest({ threadId, token, messages }));
    expect(res.status).toBe(200);
    // The runtime sees the trimmed body, not the full replayed history.
    const forwarded = endpointFetch.mock.calls[0]?.[0] as Request;
    const body = (await forwarded.json()) as { messages: unknown[]; threadId: string };
    expect(body.messages).toEqual([{ role: "user", content: "the new turn" }]);
    // Other fields are preserved.
    expect(body.threadId).toBe(threadId);
  });
});
