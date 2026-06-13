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
const getLocalAgents = vi.hoisted(() => vi.fn(() => []));
const endpointFetch = vi.hoisted(() => vi.fn(async () => new Response("{}", { status: 200 })));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/tutor-code-store", () => ({ checkTutorCode }));
vi.mock("@/lib/user-chat-store", () => ({ recordUserChat }));
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

import {
  getThreadTokenSecret,
  resetThreadTokenSecretForTests,
  signThreadToken,
} from "@/lib/thread-token";
import { GET, POST } from "./route";

const CODE = "a1b2c3d4e5";
const USER_ID = "user-1";
const BASE = "http://localhost/api/copilotkit";

function runBody(threadId: string | undefined) {
  return JSON.stringify({
    ...(threadId === undefined ? {} : { threadId }),
    runId: "r1",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  });
}

function runRequest(opts: { threadId?: string; token?: string; code?: string } = {}) {
  const headers: Record<string, string> = {
    "x-tutor-code": opts.code ?? CODE,
    "content-type": "application/json",
  };
  if (opts.token !== undefined) headers["x-thread-token"] = opts.token;
  return new Request(`${BASE}/agent/tutor/run`, {
    method: "POST",
    headers,
    body: runBody(opts.threadId),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetThreadTokenSecretForTests();
  // Default: an authenticated student with a valid code. Individual tests
  // override as needed.
  auth.mockResolvedValue({ user: { id: USER_ID } });
  checkTutorCode.mockResolvedValue({ ok: true, entry: { tutorUrl: "https://example.com/t.yaml" } });
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
