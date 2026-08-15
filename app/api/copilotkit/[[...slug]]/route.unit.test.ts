// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// The chat runtime route gates every DATA request (run/connect/stop) with three
// server-side checks (auth → code → thread-ownership token) before it ever builds
// the Mastra runtime, and dispatches by the code's `module` (which agent runs).
// GET `/info` is the exception: metadata only, gated by AUTH ALONE (the read-only
// conversation viewer needs it without a code). Those checks are the security
// boundary, and they all short-circuit with a 401/403/404 — so they can be
// exercised fast, with no DB and no LLM, by mocking only the I/O seams and driving
// real `Request`s through the handler.
//
// What is REAL here: `classifyRequest` (the endpoint allowlist) and the
// thread-token HMAC (`lib/thread-token.ts`). What is mocked: the session, the code
// lookup, the module registry, and everything downstream of a passed gate (the
// CopilotKit runtime, the Mastra agent factory, the attribution write).

const auth = vi.hoisted(() => vi.fn());
const checkCode = vi.hoisted(() => vi.fn());
const recordUserChat = vi.hoisted(() => vi.fn());
const recordUserMessage = vi.hoisted(() => vi.fn());
// The RequestContext the route mutates with the usage-attribution keys before
// building the runtime; a spy `set` lets us assert it, and stands in for the real
// RequestContext.set().
const contextSet = vi.hoisted(() => vi.fn());
const buildRequestContext = vi.hoisted(() =>
  vi.fn(
    async (): Promise<
      | { ok: true; context: { set: (k: string, v: unknown) => void } }
      | { ok: false; status: number; message: string }
    > => ({ ok: true, context: { set: contextSet } }),
  ),
);
const getLocalAgents = vi.hoisted(() => vi.fn(() => []));
const endpointFetch = vi.hoisted(() =>
  vi.fn(async (_req: Request) => new Response("{}", { status: 200 })),
);

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/code-store", () => ({ checkCode }));
vi.mock("@/lib/user-chat-store", () => ({ recordUserChat }));
vi.mock("@/lib/usage-store", () => ({ recordUserMessage }));
// The module registry decides which agent runs per module. Both modules share one
// buildRequestContext mock so a test can flip it to the error path.
vi.mock("@/lib/code-modules/registry", () => ({
  codeModules: {
    tutor: { fileKind: "tutor", runtime: { agentId: "tutor", buildRequestContext } },
    quiz: { fileKind: "quiz", runtime: { agentId: "quizDiscussion", buildRequestContext } },
    writing: { fileKind: "writing", runtime: { agentId: "writing", buildRequestContext } },
  },
}));
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

// AUTH_SECRET must exist before the thread-token secret is first derived; the
// thread-token module is REAL and memoizes it, so reset between tests.
process.env.AUTH_SECRET = "test-secret-for-route-unit";

import {
  getThreadTokenSecret,
  resetThreadTokenSecretForTests,
  signThreadToken,
} from "@/lib/thread-token";
import { USAGE_CODE, USAGE_MODULE, USAGE_USER_ID } from "@/lib/usage-context-keys";
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
  opts: {
    threadId?: string;
    token?: string;
    code?: string;
    messages?: unknown[];
    agent?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "x-code": opts.code ?? CODE,
    "content-type": "application/json",
  };
  if (opts.token !== undefined) headers["x-thread-token"] = opts.token;
  return new Request(`${BASE}/agent/${opts.agent ?? "tutor"}/run`, {
    method: "POST",
    headers,
    body: runBody(opts.threadId, opts.messages),
  });
}

function token(threadId: string, code = CODE, userId = USER_ID) {
  return signThreadToken({ code, userId, threadId }, getThreadTokenSecret());
}

beforeEach(() => {
  vi.clearAllMocks();
  resetThreadTokenSecretForTests();
  // Default: an authenticated student with a valid tutor-module code. Individual
  // tests override as needed.
  auth.mockResolvedValue({ user: { id: USER_ID } });
  checkCode.mockResolvedValue({
    ok: true,
    entry: { module: "tutor", fileUrl: "https://example.com/t.yaml" },
  });
  buildRequestContext.mockResolvedValue({ ok: true, context: { set: contextSet } });
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

describe("code gate (re-checked on every data request)", () => {
  it("403s an unknown code with a human-readable message", async () => {
    checkCode.mockResolvedValue({ ok: false, reason: "unknown-code" });
    const res = await POST(runRequest({ threadId: crypto.randomUUID() }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/requires a valid code/i);
  });

  it("403s an expired code — the per-request window re-check (mid-session close)", async () => {
    checkCode.mockResolvedValue({
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
    const res = await GET(new Request(`${BASE}/threads`, { headers: { "x-code": CODE } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("404s the runtime's thread-messages endpoint", async () => {
    const res = await GET(
      new Request(`${BASE}/threads/${crypto.randomUUID()}/messages`, {
        headers: { "x-code": CODE },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("404s an unknown sub-path", async () => {
    const res = await POST(
      new Request(`${BASE}/agent/tutor/bogus`, {
        method: "POST",
        headers: { "x-code": CODE, "content-type": "application/json" },
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
    const res = await POST(runRequest({ token: token("x") }));
    expect(res.status).toBe(403);
  });

  it("403s a run whose token was signed for a different user", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(runRequest({ threadId, token: token(threadId, CODE, "someone-else") }));
    expect(res.status).toBe(403);
  });
});

describe("info endpoint (auth-only metadata)", () => {
  it("serves GET /info with auth alone — no code, no code check", async () => {
    const res = await GET(new Request(`${BASE}/info`));
    expect(res.status).toBe(200);
    expect(endpointFetch).toHaveBeenCalledOnce();
    expect(checkCode).not.toHaveBeenCalled();
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

describe("happy path past the gate (tutor module)", () => {
  it("forwards a run carrying a correctly-signed token, scoped to the code", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(runRequest({ threadId, token: token(threadId) }));
    expect(res.status).toBe(200);
    expect(getLocalAgents).toHaveBeenCalledWith(expect.objectContaining({ resourceId: CODE }));
    // The three usage-attribution keys are set on the request context for the
    // observability exporter (usageUserId is set even though tutor defaults anonymous).
    expect(contextSet).toHaveBeenCalledWith(USAGE_CODE, CODE);
    expect(contextSet).toHaveBeenCalledWith(USAGE_USER_ID, USER_ID);
    expect(contextSet).toHaveBeenCalledWith(USAGE_MODULE, "tutor");
  });

  it("404s a tutor-module request targeting a non-tutor agent (grader unreachable)", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(
      runRequest({ threadId, token: token(threadId), agent: "quizEvaluator" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("quiz module (reached via a quiz-module code)", () => {
  beforeEach(() => {
    checkCode.mockResolvedValue({
      ok: true,
      entry: { module: "quiz", fileUrl: "https://example.com/api/files/q" },
    });
  });

  it("forwards a discussion run to quizDiscussion, scoped to the CODE", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(
      runRequest({ threadId, token: token(threadId), agent: "quizDiscussion" }),
    );
    expect(res.status).toBe(200);
    // resourceId is the CODE for every module now (not the quiz URL).
    expect(getLocalAgents).toHaveBeenCalledWith(expect.objectContaining({ resourceId: CODE }));
  });

  it("404s a quiz-module request targeting quizEvaluator (grader is never web-reachable)", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(
      runRequest({ threadId, token: token(threadId), agent: "quizEvaluator" }),
    );
    expect(res.status).toBe(404);
    expect(getLocalAgents).not.toHaveBeenCalled();
  });

  it("404s a quiz-module request targeting evalJudge (the judge is never web-reachable)", async () => {
    // The second registered-but-internal agent (docs/cli-eval.md): its ONE caller is the
    // teacher-only bearer route POST /api/eval/judge.
    const threadId = crypto.randomUUID();
    const res = await POST(runRequest({ threadId, token: token(threadId), agent: "evalJudge" }));
    expect(res.status).toBe(404);
    expect(getLocalAgents).not.toHaveBeenCalled();
  });

  it("404s a quiz-module request targeting evalTutor (the eval tutor is never web-reachable)", async () => {
    // The third registered-but-internal agent (docs/cli-eval.md): its ONE caller is the
    // teacher-only bearer route POST /api/eval/respond.
    const threadId = crypto.randomUUID();
    const res = await POST(runRequest({ threadId, token: token(threadId), agent: "evalTutor" }));
    expect(res.status).toBe(404);
    expect(getLocalAgents).not.toHaveBeenCalled();
  });

  it("forwards the runtime status when buildRequestContext fails (e.g. quiz load 502)", async () => {
    buildRequestContext.mockResolvedValue({ ok: false, status: 502, message: "quiz unavailable" });
    const threadId = crypto.randomUUID();
    const res = await POST(
      runRequest({ threadId, token: token(threadId), agent: "quizDiscussion" }),
    );
    expect(res.status).toBe(502);
    expect(getLocalAgents).not.toHaveBeenCalled();
  });
});

describe("writing module (reached via a writing-module code)", () => {
  beforeEach(() => {
    checkCode.mockResolvedValue({
      ok: true,
      entry: { module: "writing", fileUrl: "https://example.com/api/files/w" },
    });
  });

  it("forwards a run to the writing agent, scoped to the CODE, building its context", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(runRequest({ threadId, token: token(threadId), agent: "writing" }));
    expect(res.status).toBe(200);
    expect(buildRequestContext).toHaveBeenCalledOnce();
    expect(getLocalAgents).toHaveBeenCalledWith(expect.objectContaining({ resourceId: CODE }));
  });

  it("404s a writing-module request targeting a non-runtime agent id", async () => {
    const threadId = crypto.randomUUID();
    const res = await POST(
      runRequest({ threadId, token: token(threadId), agent: "quizEvaluator" }),
    );
    expect(res.status).toBe(404);
    expect(getLocalAgents).not.toHaveBeenCalled();
  });

  it("forwards the runtime status when buildRequestContext fails (writing load 502)", async () => {
    buildRequestContext.mockResolvedValue({
      ok: false,
      status: 502,
      message: "writing unavailable",
    });
    const threadId = crypto.randomUUID();
    const res = await POST(runRequest({ threadId, token: token(threadId), agent: "writing" }));
    expect(res.status).toBe(502);
    expect(getLocalAgents).not.toHaveBeenCalled();
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
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "the new turn" },
    ];
    const res = await POST(runRequest({ threadId, token: token(threadId), messages }));
    expect(res.status).toBe(200);
    const forwarded = endpointFetch.mock.calls[0]?.[0] as Request;
    const body = (await forwarded.json()) as { messages: unknown[]; threadId: string };
    expect(body.messages).toEqual([{ role: "user", content: "the new turn" }]);
    expect(body.threadId).toBe(threadId);
  });
});
