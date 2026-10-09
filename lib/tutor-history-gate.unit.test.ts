// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const ownsTutorThread = vi.hoisted(() => vi.fn());
const readAnonymousFlag = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tutor-history-store", () => ({ ownsTutorThread }));
vi.mock("@/lib/file-validators", () => ({ readAnonymousFlag }));

import {
  historyEnabled,
  ownerMayReopen,
  TUTOR_RESUME_GRACE_MS,
  TUTOR_RESUME_IDLE_MS,
  withinResumeWindow,
} from "@/lib/tutor-history-gate";

// The resume rule shared by the resume action (no grace) and the snapshot runner
// (limit + grace).

const MINUTE = 60 * 1000;
const NOW = new Date("2026-10-09T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

describe("withinResumeWindow", () => {
  it("is a one-hour limit with a five-minute grace", () => {
    expect(TUTOR_RESUME_IDLE_MS).toBe(60 * MINUTE);
    expect(TUTOR_RESUME_GRACE_MS).toBe(5 * MINUTE);
  });

  it("never resumes a thread without messages", () => {
    expect(withinResumeWindow(null, NOW)).toBe(false);
    expect(withinResumeWindow(null, NOW, TUTOR_RESUME_GRACE_MS)).toBe(false);
  });

  it("action rule (no grace): 59 min yes, 60 and 61 min no", () => {
    expect(withinResumeWindow(ago(59), NOW)).toBe(true);
    expect(withinResumeWindow(ago(60), NOW)).toBe(false);
    expect(withinResumeWindow(ago(61), NOW)).toBe(false);
  });

  it("runner rule (limit + grace): 59 and 64 min yes, 65 and 66 min no", () => {
    expect(withinResumeWindow(ago(59), NOW, TUTOR_RESUME_GRACE_MS)).toBe(true);
    expect(withinResumeWindow(ago(64), NOW, TUTOR_RESUME_GRACE_MS)).toBe(true);
    expect(withinResumeWindow(ago(65), NOW, TUTOR_RESUME_GRACE_MS)).toBe(false);
    expect(withinResumeWindow(ago(66), NOW, TUTOR_RESUME_GRACE_MS)).toBe(false);
  });
});

describe("historyEnabled (both copies of the anonymous flag)", () => {
  it.each([
    [false, false, true],
    [false, true, false],
    [true, false, false],
    [true, true, false],
  ])("frozen %s, live %s → %s", (frozen, live, expected) => {
    expect(historyEnabled(frozen, live)).toBe(expected);
  });
});

describe("ownerMayReopen (the snapshot runner's branch past the limit)", () => {
  const INPUT = {
    code: "c0de",
    frozenAnonymous: false,
    fileUrl: "https://e/t.yaml",
    userId: "student-1",
    threadId: "t-1",
  };

  beforeEach(() => {
    ownsTutorThread.mockReset().mockResolvedValue(true);
    readAnonymousFlag.mockReset().mockResolvedValue({ anonymous: false, definitive: true });
  });

  it("allows the owner on a history-enabled code", async () => {
    expect(await ownerMayReopen(INPUT)).toBe(true);
    expect(ownsTutorThread).toHaveBeenCalledWith("student-1", "c0de", "t-1");
  });

  it("refuses without an ownership row, or when the lookup fails", async () => {
    ownsTutorThread.mockResolvedValue(false);
    expect(await ownerMayReopen(INPUT)).toBe(false);
    ownsTutorThread.mockResolvedValue(undefined);
    expect(await ownerMayReopen(INPUT)).toBe(false);
  });

  it("refuses a frozen-anonymous code without reading anything", async () => {
    expect(await ownerMayReopen({ ...INPUT, frozenAnonymous: true })).toBe(false);
    expect(readAnonymousFlag).not.toHaveBeenCalled();
    expect(ownsTutorThread).not.toHaveBeenCalled();
  });

  it("refuses a live-anonymous or unreadable YAML", async () => {
    readAnonymousFlag.mockResolvedValue({ anonymous: true, definitive: false });
    expect(await ownerMayReopen(INPUT)).toBe(false);
    expect(ownsTutorThread).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    readAnonymousFlag.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ownerMayReopen(INPUT)).toBe(false);
  });
});
