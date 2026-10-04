// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  markSeen: vi.fn(),
  invalidateHome: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/achievement-store", () => ({ markSeen: mocks.markSeen }));
vi.mock("@/lib/home-data", () => ({ invalidateHome: mocks.invalidateHome }));

import { markAchievementsSeen } from "@/lib/achievement-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "session-user" } });
  mocks.markSeen.mockResolvedValue(true);
});

describe("markAchievementsSeen", () => {
  it("marks the ids for the SESSION user and drops their cached home", async () => {
    await expect(markAchievementsSeen(["weekly-streak-2", "active-days-10"])).resolves.toEqual({
      ok: true,
    });
    expect(mocks.markSeen).toHaveBeenCalledWith("session-user", [
      "weekly-streak-2",
      "active-days-10",
    ]);
    expect(mocks.invalidateHome).toHaveBeenCalledWith("session-user");
  });

  it("rejects malformed input without touching the store", async () => {
    for (const input of [
      "weekly-streak-2",
      [1, 2],
      [""],
      ["x".repeat(65)],
      Array.from({ length: 65 }, (_, i) => `id-${i}`),
      null,
      { ids: ["a"] },
    ]) {
      await expect(markAchievementsSeen(input)).resolves.toEqual({ ok: false });
    }
    expect(mocks.markSeen).not.toHaveBeenCalled();
  });

  it("does nothing without a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(markAchievementsSeen(["a-1"])).resolves.toEqual({ ok: false });
    expect(mocks.markSeen).not.toHaveBeenCalled();
    expect(mocks.invalidateHome).not.toHaveBeenCalled();
  });

  it("an empty list is a no-op", async () => {
    await expect(markAchievementsSeen([])).resolves.toEqual({ ok: true });
    expect(mocks.markSeen).not.toHaveBeenCalled();
  });

  it("reports a failed write as not ok, still invalidating", async () => {
    mocks.markSeen.mockResolvedValue(false);
    await expect(markAchievementsSeen(["a-1"])).resolves.toEqual({ ok: false });
    expect(mocks.invalidateHome).toHaveBeenCalledWith("session-user");
  });
});
