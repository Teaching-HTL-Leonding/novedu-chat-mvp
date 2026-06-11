import { describe, expect, it } from "vitest";
import { sampleExampleQuestions } from "./sample";

/** Deterministic RNG: cycles through the given values. */
const fakeRandom = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe("sampleExampleQuestions", () => {
  it("returns all items (as a copy) when there are at most `max`", () => {
    const items = ["a", "b", "c"];
    const result = sampleExampleQuestions(items, 5, fakeRandom(0.99));
    expect(result).toEqual(["a", "b", "c"]);
    expect(result).not.toBe(items);
  });

  it("returns exactly `max` items when there are more", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"];
    expect(sampleExampleQuestions(items, 5, fakeRandom(0.1, 0.9, 0.5, 0.3, 0.7))).toHaveLength(5);
  });

  it("returns a subset in definition order", () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = sampleExampleQuestions(items, 5, fakeRandom(0.93, 0.11, 0.78, 0.42, 0.66));
    expect(new Set(result).size).toBe(5);
    expect(result).toEqual([...result].sort((a, b) => a - b)); // items are their own indices
    for (const item of result) expect(items).toContain(item);
  });

  it("can pick the last item (random() close to 1 stays in bounds)", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const result = sampleExampleQuestions(items, 5, fakeRandom(0.999999));
    expect(result).toHaveLength(5);
    expect(result).toContain("f");
  });

  it("is deterministic for a fixed RNG", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const rngValues = [0.2, 0.8, 0.4, 0.6, 0.1];
    const first = sampleExampleQuestions(items, 5, fakeRandom(...rngValues));
    const second = sampleExampleQuestions(items, 5, fakeRandom(...rngValues));
    expect(first).toEqual(second);
  });
});
