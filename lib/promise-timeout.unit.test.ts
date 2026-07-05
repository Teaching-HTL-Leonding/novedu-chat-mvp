import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "@/lib/promise-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("passes a resolution through", async () => {
    await expect(withTimeout(Promise.resolve(42), "Work", 1_000)).resolves.toBe(42);
  });

  it("passes a rejection through", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), "Work", 1_000)).rejects.toThrow(
      "boom",
    );
  });

  it("rejects with a named timeout error when the work never settles", async () => {
    vi.useFakeTimers();
    const hung = withTimeout(new Promise<never>(() => {}), "Entra token acquisition", 100);
    const assertion = expect(hung).rejects.toThrow(
      "Entra token acquisition timed out after 100 ms",
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("clears the timer when the work settles first (no dangling timeout)", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("done"), "Work", 5_000)).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });
});
