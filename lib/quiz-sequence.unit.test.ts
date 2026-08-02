import { describe, expect, it } from "vitest";
import { buildQuestionSequence } from "@/lib/quiz-sequence";

// The pure attempt-sequence builder. Fully deterministic here: every randomized
// expectation runs with a seeded RNG (mulberry32), so shuffle behavior — passes,
// the no-immediate-repeat rule, truncation — is asserted exactly, not statistically.

/** Tiny deterministic PRNG (mulberry32) — same seed, same sequence. */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = ["a", "b", "c", "d", "e"];

describe("buildQuestionSequence — count omitted (today's behavior)", () => {
  it("shuffle off: the pool exactly once, in order", () => {
    expect(buildQuestionSequence(POOL, { shuffle: false })).toEqual(POOL);
  });

  it("shuffle on: a permutation of the pool (same multiset, order from the rng)", () => {
    const out = buildQuestionSequence(POOL, { shuffle: true, rng: seededRng(1) });
    expect(out).toHaveLength(POOL.length);
    expect([...out].sort()).toEqual([...POOL].sort());
    // Different seeds produce different orders (deterministically picked seeds).
    const other = buildQuestionSequence(POOL, { shuffle: true, rng: seededRng(2) });
    expect(other).not.toEqual(out);
  });
});

describe("buildQuestionSequence — count below the pool size", () => {
  it("shuffle off: the first N, in authored order (predictable for authors)", () => {
    expect(buildQuestionSequence(POOL, { shuffle: false, count: 3 })).toEqual(["a", "b", "c"]);
  });

  it("shuffle on: a random N-subset without repeats, varying with the rng", () => {
    const out = buildQuestionSequence(POOL, { shuffle: true, count: 3, rng: seededRng(1) });
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    for (const q of out) expect(POOL).toContain(q);
    const other = buildQuestionSequence(POOL, { shuffle: true, count: 3, rng: seededRng(2) });
    expect(other).not.toEqual(out);
  });

  it("count = 1 asks exactly one question", () => {
    expect(buildQuestionSequence(POOL, { shuffle: false, count: 1 })).toEqual(["a"]);
    expect(
      buildQuestionSequence(POOL, { shuffle: true, count: 1, rng: seededRng(3) }),
    ).toHaveLength(1);
  });
});

describe("buildQuestionSequence — count above the pool size (drill mode)", () => {
  it("shuffle off: sequential cycling 1…N, 1…N, … truncated to count", () => {
    expect(buildQuestionSequence(["a", "b", "c"], { shuffle: false, count: 8 })).toEqual([
      "a",
      "b",
      "c",
      "a",
      "b",
      "c",
      "a",
      "b",
    ]);
  });

  it("shuffle on: full coverage of the pool before any repeat (per pass)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const out = buildQuestionSequence(POOL, { shuffle: true, count: 12, rng: seededRng(seed) });
      expect(out).toHaveLength(12);
      // Each full pass is a permutation of the pool — even coverage before repeats.
      expect([...out.slice(0, 5)].sort()).toEqual([...POOL].sort());
      expect([...out.slice(5, 10)].sort()).toEqual([...POOL].sort());
    }
  });

  it("never repeats a question immediately across a pass boundary", () => {
    for (const seed of Array.from({ length: 50 }, (_, i) => i + 1)) {
      const out = buildQuestionSequence(POOL, { shuffle: true, count: 15, rng: seededRng(seed) });
      for (let i = 1; i < out.length; i++) {
        expect(out[i], `seed ${seed}, position ${i}`).not.toBe(out[i - 1]);
      }
    }
  });

  it("a single-question pool repeats by necessity", () => {
    expect(buildQuestionSequence(["only"], { shuffle: true, count: 3, rng: seededRng(1) })).toEqual(
      ["only", "only", "only"],
    );
    expect(buildQuestionSequence(["only"], { shuffle: false, count: 2 })).toEqual(["only", "only"]);
  });
});

describe("buildQuestionSequence — edges", () => {
  it("an empty pool yields an empty sequence regardless of count", () => {
    expect(buildQuestionSequence([], { shuffle: true, count: 5 })).toEqual([]);
    expect(buildQuestionSequence([], { shuffle: false })).toEqual([]);
  });

  it("compares by identity, so equal-looking objects stay distinct pool entries", () => {
    const twin1 = { id: "same" };
    const twin2 = { id: "same" };
    const out = buildQuestionSequence([twin1, twin2], {
      shuffle: true,
      count: 4,
      rng: seededRng(7),
    });
    expect(out.filter((q) => q === twin1)).toHaveLength(2);
    expect(out.filter((q) => q === twin2)).toHaveLength(2);
  });
});
