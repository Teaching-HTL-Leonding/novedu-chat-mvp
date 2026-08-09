// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency, withRetry } from "./retry";

// The two eval primitives, with their timing seam injected so nothing waits.

describe("withRetry", () => {
  it("returns the first outcome shouldRetry rejects, without sleeping", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const work = vi.fn(async () => "fine");

    const result = await withRetry(work, { shouldRetry: () => false, sleep });

    expect(result).toBe("fine");
    expect(work).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries up to `attempts` times and returns the last outcome", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const work = vi.fn(async () => "bad");

    const result = await withRetry(work, {
      attempts: 4,
      baseDelayMs: 5000,
      shouldRetry: (value) => value === "bad",
      sleep,
    });

    expect(result).toBe("bad");
    expect(work).toHaveBeenCalledTimes(4);
    // LINEAR backoff before attempts 2..4 (PoC parity), never before the first.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5000, 10000, 15000]);
  });

  it("stops as soon as an attempt succeeds", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const outcomes = ["bad", "bad", "good"];
    const work = vi.fn(async (attempt: number) => outcomes[attempt - 1]);

    const result = await withRetry(work, {
      baseDelayMs: 1,
      shouldRetry: (value) => value === "bad",
      sleep,
    });

    expect(result).toBe("good");
    expect(work).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves INPUT order regardless of completion order", async () => {
    const delays = [30, 5, 20, 1];

    const results = await mapWithConcurrency(delays, 2, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${index}:${ms}`;
    });

    expect(results).toEqual(["0:30", "1:5", "2:20", "3:1"]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency([...Array(12).keys()], 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return null;
    });

    expect(peak).toBe(3);
  });

  it("handles an empty list and a limit above the item count", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });
});
