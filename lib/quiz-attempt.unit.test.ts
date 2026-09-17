import { describe, expect, it } from "vitest";
import {
  type AttemptState,
  canSkip,
  completeCurrent,
  currentSlot,
  progressPosition,
  skipCurrent,
  skippedUnanswered,
  skippedWaiting,
  startAttempt,
} from "@/lib/quiz-attempt";

// The pure attempt walk ("back of the line" skipping). Slots are sequence
// positions; `keyOf` maps a slot to the question it asks.

const distinct = (slot: number) => `q${slot}`;

function walk(state: AttemptState, steps: ("skip" | "answer")[], keyOf = distinct): AttemptState {
  return steps.reduce(
    (s, step) => (step === "skip" ? skipCurrent(s, keyOf) : completeCurrent(s, keyOf)),
    state,
  );
}

describe("startAttempt", () => {
  it("queues every slot in sequence order, nothing skipped", () => {
    const s = startAttempt(3);
    expect(s.pending).toEqual([0, 1, 2]);
    expect(s.skipped.size).toBe(0);
    expect(currentSlot(s)).toBe(0);
  });

  it("an empty attempt has no current slot", () => {
    expect(currentSlot(startAttempt(0))).toBeUndefined();
  });
});

describe("skipCurrent", () => {
  it("moves the current slot to the back of the line", () => {
    const s = skipCurrent(startAttempt(4), distinct);
    expect(s.pending).toEqual([1, 2, 3, 0]);
    expect([...s.skipped]).toEqual([0]);
  });

  it("several skips come back in the order they were skipped, after the unseen ones", () => {
    const s = walk(startAttempt(4), ["skip", "skip", "answer"]);
    expect(s.pending).toEqual([3, 0, 1]);
  });

  it("a returning question can be skipped again", () => {
    const s = walk(startAttempt(3), ["skip", "answer", "answer", "skip"]);
    expect(s.pending).toEqual([0]);
    // Only one slot left: nothing to skip past, so a further skip is a no-op.
    expect(canSkip(s)).toBe(false);
    expect(skipCurrent(s, distinct)).toBe(s);
  });

  it("does not mutate the previous state", () => {
    const before = startAttempt(3);
    skipCurrent(before, distinct);
    expect(before.pending).toEqual([0, 1, 2]);
    expect(before.skipped.size).toBe(0);
  });
});

describe("completeCurrent", () => {
  it("removes the current slot; the attempt ends when none are left", () => {
    const s = walk(startAttempt(2), ["answer", "answer"]);
    expect(s.pending).toEqual([]);
    expect(currentSlot(s)).toBeUndefined();
    expect(completeCurrent(s, distinct)).toBe(s);
  });
});

describe("no immediate repeat (drill mode)", () => {
  it("a skip never re-shows the same question next when another one is pending", () => {
    // Slots 0 and 1 both ask A; slot 2 asks B.
    const keys = ["A", "A", "B"];
    const keyOf = (slot: number) => keys[slot];
    const s = skipCurrent(startAttempt(3), keyOf);
    expect(s.pending).toEqual([2, 1, 0]);
  });

  it("answering never shows the same question next when another one is pending", () => {
    // Slots 0 and 2 both ask A, slot 1 asks B; earlier skips left the line at
    // [0(A), 2(A), 1(B)] — answering slot 0 must not put slot 2 next.
    const keys = ["A", "B", "A"];
    const keyOf = (slot: number) => keys[slot];
    const s = completeCurrent({ pending: [0, 2, 1], skipped: new Set([1]) }, keyOf);
    expect(s.pending).toEqual([1, 2]);
  });

  it("keeps the repeat when nothing different is left", () => {
    const keyOf = () => "only";
    expect(skipCurrent(startAttempt(3), keyOf).pending).toEqual([1, 2, 0]);
    expect(completeCurrent(startAttempt(3), keyOf).pending).toEqual([1, 2]);
  });
});

describe("derived counts", () => {
  it("progress does not advance on a skip, only on an answer", () => {
    let s = startAttempt(4);
    expect(progressPosition(s, 4)).toBe(1);
    s = skipCurrent(s, distinct);
    expect(progressPosition(s, 4)).toBe(1);
    s = completeCurrent(s, distinct);
    expect(progressPosition(s, 4)).toBe(2);
  });

  it("counts skipped slots waiting behind the current one, and unanswered at the end", () => {
    let s = walk(startAttempt(4), ["skip", "skip"]);
    expect(s.pending).toEqual([2, 3, 0, 1]);
    expect(skippedWaiting(s)).toBe(2);
    s = walk(s, ["answer", "answer"]);
    // Current slot 0 was skipped earlier; only slot 1 waits behind it.
    expect(skippedWaiting(s)).toBe(1);
    expect(skippedUnanswered(s)).toBe(2);
    s = completeCurrent(s, distinct);
    expect(skippedUnanswered(s)).toBe(1);
  });
});
