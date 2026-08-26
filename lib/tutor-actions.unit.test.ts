// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";

// The tutor "start over" action. The two I/O seams — the session and the code
// gate — are mocked, but `lib/thread-token` stays REAL (docs/testing.md:
// security-critical pure modules are exercised for real), so the minted token is
// a genuine HMAC and the assertions below prove the actual binding: the token
// works for (code, session user, new thread) and for nothing else.

const auth = vi.hoisted(() => vi.fn());
const checkCode = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/code-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/code-store")>()),
  checkCode,
}));

import {
  getThreadTokenSecret,
  resetThreadTokenSecretForTests,
  verifyThreadToken,
} from "@/lib/thread-token";
import { startNewTutorThread } from "@/lib/tutor-actions";

const CODE = "a1b2c3d4e5";
const USER = "student-1";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "unit-test-secret";
  resetThreadTokenSecretForTests();
  auth.mockResolvedValue({ user: { id: USER } });
  checkCode.mockResolvedValue({ ok: true, entry: { code: CODE, module: "tutor" } });
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
  auth.mockResolvedValue(null);

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
