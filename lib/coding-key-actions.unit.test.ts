import { beforeEach, describe, expect, it, vi } from "vitest";

// The "Get my API key" server action is a thin auth + validation shell around
// `getOrCreateCodingKey` (covered by coding-key-store.unit.test.ts) — these tests
// pin the SHELL: the effective-teacher gate, that an unknown / deleted /
// non-coding code is refused WITHOUT minting, the happy path's mint +
// revalidate, and that the key value never travels back to the client.

const mocks = vi.hoisted(() => ({
  requireTeacherUserId: vi.fn(),
  getCode: vi.fn(),
  getOrCreateCodingKey: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/student-mode", () => ({ requireTeacherUserId: mocks.requireTeacherUserId }));
vi.mock("@/lib/code-store", () => ({ getCode: mocks.getCode }));
vi.mock("@/lib/coding-key-store", () => ({ getOrCreateCodingKey: mocks.getOrCreateCodingKey }));

import { mintCodingKeyAction } from "@/lib/coding-key-actions";

const CODE = "a1b2c3d4e5";
const codingEntry = { code: CODE, module: "coding", fileUrl: "https://example.com/c.yaml" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTeacherUserId.mockResolvedValue({ ok: true, userId: "teacher-oid-1" });
  mocks.getCode.mockResolvedValue(codingEntry);
  mocks.getOrCreateCodingKey.mockResolvedValue({
    code: CODE,
    userId: "teacher-oid-1",
    apiKey: "nvk-teacherkey",
    createdAt: new Date(),
  });
});

describe("the teacher gate", () => {
  it("refuses a non-teacher (student mode included) without minting", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
    const result = await mintCodingKeyAction(CODE);
    expect(result).toEqual({ ok: false, message: "Only teachers can request a key here." });
    expect(mocks.getCode).not.toHaveBeenCalled();
    expect(mocks.getOrCreateCodingKey).not.toHaveBeenCalled();
  });

  it("refuses a session with no user id — there is nothing to attribute the key to", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "no-user-id" });
    const result = await mintCodingKeyAction(CODE);
    expect(result).toEqual({
      ok: false,
      message: "Your session carries no user id — sign in again.",
    });
    expect(mocks.getOrCreateCodingKey).not.toHaveBeenCalled();
  });
});

describe("code validation", () => {
  it("refuses an unknown/deleted code without minting", async () => {
    mocks.getCode.mockResolvedValue(null);
    const result = await mintCodingKeyAction(CODE);
    expect(result).toEqual({
      ok: false,
      message: "This coding activity no longer exists. Reload the page.",
    });
    expect(mocks.getOrCreateCodingKey).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a code of another module without minting", async () => {
    mocks.getCode.mockResolvedValue({ ...codingEntry, module: "tutor" });
    const result = await mintCodingKeyAction(CODE);
    expect(result.ok).toBe(false);
    expect(mocks.getOrCreateCodingKey).not.toHaveBeenCalled();
  });

  it("reports a lookup failure as retryable, without minting", async () => {
    mocks.getCode.mockResolvedValue(undefined);
    const result = await mintCodingKeyAction(CODE);
    expect(result).toEqual({
      ok: false,
      message: "The code could not be checked right now — try again.",
    });
    expect(mocks.getOrCreateCodingKey).not.toHaveBeenCalled();
  });
});

describe("minting", () => {
  it("mints for the gate's own oid and revalidates the detail page", async () => {
    const result = await mintCodingKeyAction(CODE);
    expect(mocks.getOrCreateCodingKey).toHaveBeenCalledWith(CODE, "teacher-oid-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/codes/${CODE}`);
    expect(result).toEqual({ ok: true });
  });

  it("never returns the key value — the revalidated render is its only delivery path", async () => {
    const result = await mintCodingKeyAction(CODE);
    expect(JSON.stringify(result)).not.toContain("nvk-");
  });

  it("reports a store failure and does not revalidate", async () => {
    mocks.getOrCreateCodingKey.mockResolvedValue(null);
    const result = await mintCodingKeyAction(CODE);
    expect(result).toEqual({
      ok: false,
      message: "Your key could not be created right now — try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
