// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
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
