// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  bucketKeyOf,
  foldTopN,
  OTHER_KEY,
  OTHER_LABEL,
  parseRange,
  resolveRange,
  type Slice,
  type TokenSums,
  zeroFill,
} from "@/lib/usage-range";

// Pure UTC windowing/bucketing for the usage dashboard — no I/O, `now` injected, so
// every assertion is deterministic. Labels are UTC en-US (Node ships full ICU).

const NOW = new Date("2026-07-04T14:30:00Z");

describe("parseRange", () => {
  it("accepts the four known ranges", () => {
    for (const r of ["24h", "7d", "30d", "365d"] as const) expect(parseRange(r)).toBe(r);
  });

  it("defaults to 24h for anything else", () => {
    expect(parseRange(undefined)).toBe("24h");
    expect(parseRange("nonsense")).toBe("24h");
    expect(parseRange(["7d"])).toBe("24h"); // array param → default (Next gives string|string[])
  });
});

describe("resolveRange", () => {
  it("24h → 24 hourly buckets ending at the current hour", () => {
    const r = resolveRange("24h", NOW);
    expect(r.grain).toBe("hour");
    expect(r.buckets).toHaveLength(24);
    expect(r.start.toISOString()).toBe("2026-07-03T15:00:00.000Z");
    expect(r.buckets[0]?.label).toBe("15:00");
    expect(r.buckets[23]?.label).toBe("14:00");
    // The key of the last bucket is the current hour's start.
    expect(r.buckets[23]?.key).toBe("2026-07-04T14:00:00.000Z");
  });

  it("7d → 7 daily buckets ending today", () => {
    const r = resolveRange("7d", NOW);
    expect(r.grain).toBe("day");
    expect(r.buckets).toHaveLength(7);
    expect(r.start.toISOString()).toBe("2026-06-28T00:00:00.000Z");
    expect(r.buckets[0]?.label).toBe("Jun 28");
    expect(r.buckets[6]?.label).toBe("Jul 4");
  });

  it("30d → 30 daily buckets", () => {
    const r = resolveRange("30d", NOW);
    expect(r.grain).toBe("day");
    expect(r.buckets).toHaveLength(30);
    expect(r.start.toISOString()).toBe("2026-06-05T00:00:00.000Z");
    expect(r.buckets[29]?.label).toBe("Jul 4");
  });

  it("365d → 12 monthly buckets ending this month", () => {
    const r = resolveRange("365d", NOW);
    expect(r.grain).toBe("month");
    expect(r.buckets).toHaveLength(12);
    expect(r.start.toISOString()).toBe("2025-08-01T00:00:00.000Z");
    expect(r.buckets[0]?.label).toBe("Aug 2025");
    expect(r.buckets[11]?.label).toBe("Jul 2026");
  });
});

describe("bucketKeyOf", () => {
  it("floors an instant to its bucket start (matching resolveRange keys)", () => {
    expect(bucketKeyOf(new Date("2026-07-04T14:59:59Z"), "hour")).toBe("2026-07-04T14:00:00.000Z");
    expect(bucketKeyOf(new Date("2026-07-04T23:30:00Z"), "day")).toBe("2026-07-04T00:00:00.000Z");
    expect(bucketKeyOf(new Date("2026-07-31T12:00:00Z"), "month")).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("zeroFill", () => {
  it("merges sums onto matching buckets and zeroes the rest", () => {
    const r = resolveRange("24h", NOW);
    const lastKey = r.buckets[23]?.key ?? "";
    const byKey = new Map<string, TokenSums>([
      [lastKey, { inputNew: 10, inputCached: 20, output: 5 }],
    ]);
    const filled = zeroFill(r.buckets, byKey);
    expect(filled).toHaveLength(24);
    expect(filled[23]).toMatchObject({ inputNew: 10, inputCached: 20, output: 5, label: "14:00" });
    // An untouched bucket is an explicit zero, not a gap.
    expect(filled[0]).toMatchObject({ inputNew: 0, inputCached: 0, output: 0 });
  });
});

describe("foldTopN", () => {
  const slice = (key: string, total: number): Slice => ({ key, label: key, total });

  it("returns everything (no Other) when at or below n", () => {
    const out = foldTopN([slice("a", 3), slice("b", 5)], 9);
    expect(out.map((s) => s.key)).toEqual(["b", "a"]); // sorted desc
    expect(out.some((s) => s.key === OTHER_KEY)).toBe(false);
  });

  it("breaks equal totals by key (ascending) for a stable order", () => {
    const out = foldTopN([slice("b", 5), slice("a", 5), slice("c", 5)], 9);
    expect(out.map((s) => s.key)).toEqual(["a", "b", "c"]);
  });

  it("keeps the top n and folds the remainder into Other", () => {
    const slices = Array.from({ length: 12 }, (_, i) => slice(`c${i}`, 100 - i));
    const out = foldTopN(slices, 9);
    expect(out).toHaveLength(10);
    const other = out.at(-1);
    expect(other?.key).toBe(OTHER_KEY);
    expect(other?.label).toBe(OTHER_LABEL);
    // Bottom 3 totals: (100-9)+(100-10)+(100-11) = 91+90+89 = 270.
    expect(other?.total).toBe(270);
  });
});
