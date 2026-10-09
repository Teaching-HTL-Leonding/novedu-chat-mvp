// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// The tutor thread actions ("start over", "resume"). The two I/O seams — the session and the code
// gate — are mocked, but `lib/thread-token` stays REAL (docs/testing.md:
// security-critical pure modules are exercised for real), so the minted token is
// a genuine HMAC and the assertions below prove the actual binding: the token
// works for (code, session user, new thread) and for nothing else.

const getSession = vi.hoisted(() => vi.fn());
const checkCode = vi.hoisted(() => vi.fn());
const threadLastMessageAt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("@/lib/tutor-history-store", () => ({ threadLastMessageAt }));
vi.mock("@/lib/code-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/code-store")>()),
  checkCode,
}));

import {
  getThreadTokenSecret,
  resetThreadTokenSecretForTests,
  signThreadToken,
  verifyThreadToken,
} from "@/lib/thread-token";
import { resumeTutorThread, startNewTutorThread } from "@/lib/tutor-actions";

const CODE = "a1b2c3d4e5";
const USER = "student-1";
const MINUTE = 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "unit-test-secret";
  resetThreadTokenSecretForTests();
  getSession.mockResolvedValue({ user: { id: USER } });
  checkCode.mockResolvedValue({ ok: true, entry: { code: CODE, module: "tutor" } });
  threadLastMessageAt.mockResolvedValue(new Date(Date.now() - 5 * MINUTE));
});

it("mints a thread whose token verifies for (code, session user, thread)", async () => {
  const result = await startNewTutorThread({ code: CODE });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(
    verifyThreadToken(
      result.threadToken,
      { code: CODE, userId: USER, threadId: result.threadId },
      getThreadTokenSecret(),
    ),
  ).toBe(true);
});

it("mints a DIFFERENT thread each time — a restart never reuses the old one", async () => {
  const first = await startNewTutorThread({ code: CODE });
  const second = await startNewTutorThread({ code: CODE });

  expect(first.ok && second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  expect(second.threadId).not.toBe(first.threadId);
  expect(second.threadToken).not.toBe(first.threadToken);
});

it("binds the token to the SESSION user, not the caller", async () => {
  const result = await startNewTutorThread({ code: CODE });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // The same thread id claimed by anyone else is rejected — that binding is the
  // only thing isolating students' chats (docs/codes.md).
  expect(
    verifyThreadToken(
      result.threadToken,
      { code: CODE, userId: "someone-else", threadId: result.threadId },
      getThreadTokenSecret(),
    ),
  ).toBe(false);
  // …and so is the same token replayed against another code.
  expect(
    verifyThreadToken(
      result.threadToken,
      { code: "f5e4d3c2b1", userId: USER, threadId: result.threadId },
      getThreadTokenSecret(),
    ),
  ).toBe(false);
});

it("refuses without a signed-in user", async () => {
  getSession.mockResolvedValue(null);

  expect(await startNewTutorThread({ code: CODE })).toEqual({
    ok: false,
    message: "Please sign in to continue.",
  });
});

it.each([
  ["unknown-code", "This code is not valid."],
  ["not-started", "This activity's availability window has not started yet."],
  ["expired", "This activity's availability window has ended."],
  ["lookup-failed", "Codes cannot be checked right now — try again in a moment."],
] as const)("refuses a %s code", async (reason, message) => {
  checkCode.mockResolvedValue({ ok: false, reason });

  expect(await startNewTutorThread({ code: CODE })).toEqual({ ok: false, message });
});

it("refuses a code from another module", async () => {
  checkCode.mockResolvedValue({ ok: true, entry: { code: CODE, module: "quiz" } });

  expect(await startNewTutorThread({ code: CODE })).toEqual({
    ok: false,
    message: "This code is not a tutor.",
  });
});

it("re-checks the code on every call — a window that closed mid-session stops minting", async () => {
  expect((await startNewTutorThread({ code: CODE })).ok).toBe(true);

  checkCode.mockResolvedValue({ ok: false, reason: "expired" });

  expect((await startNewTutorThread({ code: CODE })).ok).toBe(false);
  expect(checkCode).toHaveBeenCalledTimes(2);
});

describe("resumeTutorThread", () => {
  const THREAD = "0b6f0c1e-1111-4222-8333-444455556666";

  function ownToken(over: { code?: string; userId?: string; threadId?: string } = {}) {
    return signThreadToken(
      { code: over.code ?? CODE, userId: over.userId ?? USER, threadId: over.threadId ?? THREAD },
      getThreadTokenSecret(),
    );
  }

  function resume(threadToken = ownToken(), threadId = THREAD) {
    return resumeTutorThread({ code: CODE, threadId, threadToken });
  }

  it("accepts the owner's token on a thread last written 59 minutes ago", async () => {
    threadLastMessageAt.mockResolvedValue(new Date(Date.now() - 59 * MINUTE));
    expect(await resume()).toEqual({ ok: true });
    expect(threadLastMessageAt).toHaveBeenCalledWith(CODE, THREAD);
  });

  it("rejects a malformed thread id before any lookup", async () => {
    expect(await resume(ownToken({ threadId: "x".repeat(65) }), "x".repeat(65))).toEqual({
      ok: false,
    });
    expect(await resume(ownToken({ threadId: "a b" }), "a b")).toEqual({ ok: false });
    expect(checkCode).not.toHaveBeenCalled();
    expect(threadLastMessageAt).not.toHaveBeenCalled();
  });

  it.each([
    ["another user's token", () => ownToken({ userId: "someone-else" })],
    ["a token for another code", () => ownToken({ code: "f5e4d3c2b1" })],
    ["a token for another thread", () => ownToken({ threadId: "another-thread" })],
    ["an empty token", () => ""],
  ])("rejects %s", async (_label, token) => {
    expect(await resume(token())).toEqual({ ok: false });
    expect(threadLastMessageAt).not.toHaveBeenCalled();
  });

  it.each([
    ["no messages", null],
    ["exactly 60 minutes idle", new Date(Date.now() - 60 * MINUTE)],
    ["61 minutes idle", new Date(Date.now() - 61 * MINUTE)],
    ["a store failure", undefined],
  ])("rejects a thread with %s", async (_label, lastAt) => {
    threadLastMessageAt.mockResolvedValue(lastAt);
    expect(await resume()).toEqual({ ok: false });
  });

  it("rejects a non-tutor code", async () => {
    checkCode.mockResolvedValue({ ok: true, entry: { code: CODE, module: "writing" } });
    expect(await resume()).toEqual({ ok: false });
  });

  it.each(["unknown-code", "not-started", "expired", "lookup-failed"] as const)(
    "rejects a %s code",
    async (reason) => {
      checkCode.mockResolvedValue({ ok: false, reason });
      expect(await resume()).toEqual({ ok: false });
    },
  );

  it("rejects without a session", async () => {
    getSession.mockResolvedValue(null);
    expect(await resume()).toEqual({ ok: false });
  });

  it("binds to the SESSION user: the owner's token fails for anyone else signed in", async () => {
    const token = ownToken();
    getSession.mockResolvedValue({ user: { id: "someone-else" } });
    expect(await resume(token)).toEqual({ ok: false });
  });
});
