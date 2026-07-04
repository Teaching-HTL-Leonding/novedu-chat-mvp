// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// Behavior-level tests for the dashboard read seam. The one I/O seam — the Drizzle
// handle (`@/lib/db`) — is faked; the real logic under test is the recordset
// shaping (zero-fill, module/code folding, top-9) and the never-throws contract.
// The SQL text itself is left to the @live-db e2e (same split as code-stats-store).

const fake = vi.hoisted(() => {
  const state = { recordset: [] as Record<string, unknown>[], executeError: undefined as unknown };
  const db = {
    execute: async () => {
      if (state.executeError) throw state.executeError;
      return { recordset: state.recordset };
    },
  };
  return { state, db };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import { OTHER_KEY, resolveRange } from "@/lib/usage-range";
import { getDashboardKpis, getTokenTimeSeries, getUsageBreakdown } from "@/lib/usage-stats-store";

const NOW = new Date("2026-07-04T14:30:00Z");

beforeEach(() => {
  fake.state.recordset = [];
  fake.state.executeError = undefined;
});

describe("getTokenTimeSeries", () => {
  it("zero-fills the full bucket list and maps the matching bucket's sums", async () => {
    const { buckets } = resolveRange("24h", NOW);
    const lastKey = buckets[23]?.key ?? "";
    // The store re-keys each row's SQL Date via bucketKeyOf, so a Date at the
    // current hour lands on the last bucket. Numbers may arrive as strings (bigint).
    fake.state.recordset = [
      { bucket: new Date(lastKey), inputNew: "10", inputCached: 20, output: "5" },
    ];
    const series = await getTokenTimeSeries({ range: "24h", now: NOW });
    expect(series).toHaveLength(24);
    expect(series?.[23]).toMatchObject({ inputNew: 10, inputCached: 20, output: 5 });
    expect(series?.[0]).toMatchObject({ inputNew: 0, inputCached: 0, output: 0 });
  });

  it("re-keys a non-floored day bucket onto its day and zero-fills the rest", async () => {
    // The day/month grains group in SQL, but the store re-floors each returned
    // bucket Date via `bucketKeyOf(new Date(row.bucket), grain)`. Feed a Date at a
    // non-midnight instant to prove it still lands on the right day bucket.
    fake.state.recordset = [
      { bucket: new Date("2026-07-04T14:30:00Z"), inputNew: 7, inputCached: 0, output: 0 },
    ];
    const series = await getTokenTimeSeries({ range: "7d", now: NOW });
    expect(series).toHaveLength(7);
    expect(series?.[6]).toMatchObject({ inputNew: 7, label: "Jul 4" }); // today's bucket
    expect(series?.[0]).toMatchObject({ inputNew: 0, inputCached: 0, output: 0 });
  });

  it("accepts a single-code scope (the reuse seam) and shapes the same way", async () => {
    fake.state.recordset = [];
    const series = await getTokenTimeSeries({ range: "24h", now: NOW, code: "abc" });
    expect(series).toHaveLength(24);
    expect(series?.every((b) => b.inputNew === 0 && b.inputCached === 0 && b.output === 0)).toBe(
      true,
    );
  });

  it("returns undefined instead of throwing when the query fails", async () => {
    fake.state.executeError = new Error("connection lost");
    await expect(getTokenTimeSeries({ range: "24h", now: NOW })).resolves.toBeUndefined();
  });
});

describe("getUsageBreakdown", () => {
  it("sums by module and labels codes (note, falling back to the code)", async () => {
    fake.state.recordset = [
      { code: "c1", module: "quiz", note: "Quiz One", total: 100 },
      { code: "c2", module: "quiz", note: null, total: 50 },
      { code: "c3", module: "tutor", note: "  ", total: 30 },
    ];
    const b = await getUsageBreakdown({ range: "7d", now: NOW });
    // Modules summed and sorted desc: quiz 150, tutor 30.
    expect(b?.byModule).toEqual([
      { key: "quiz", label: "quiz", total: 150 },
      { key: "tutor", label: "tutor", total: 30 },
    ]);
    // Codes: note used when present+non-blank, else the code; sorted desc.
    expect(b?.byCode.map((s) => [s.key, s.label, s.total])).toEqual([
      ["c1", "Quiz One", 100],
      ["c2", "c2", 50],
      ["c3", "c3", 30],
    ]);
  });

  it("drops modules and codes whose windowed token total is 0 (no phantom slices)", async () => {
    // A writing-save-only or quiz-answer-only code has a usage_by_code row with all
    // three token columns 0, so its windowed SUM is 0. Such categories must not
    // appear in a "tokens per module/code" pie, and must not fold into "Other: 0".
    fake.state.recordset = [
      { code: "c1", module: "tutor", note: "T", total: 100 },
      { code: "c2", module: "writing", note: "W", total: 0 },
    ];
    const b = await getUsageBreakdown({ range: "7d", now: NOW });
    expect(b?.byModule).toEqual([{ key: "tutor", label: "tutor", total: 100 }]);
    expect(b?.byCode.map((s) => s.key)).toEqual(["c1"]); // c2 dropped, no OTHER_KEY
  });

  it("folds codes beyond the top 9 into Other", async () => {
    fake.state.recordset = Array.from({ length: 11 }, (_, i) => ({
      code: `c${i}`,
      module: "tutor",
      note: null,
      total: 100 - i,
    }));
    const b = await getUsageBreakdown({ range: "30d", now: NOW });
    expect(b?.byCode).toHaveLength(10);
    expect(b?.byCode.at(-1)).toMatchObject({ key: OTHER_KEY, total: 91 + 90 }); // c9+c10
  });

  it("returns undefined instead of throwing when the query fails", async () => {
    fake.state.executeError = new Error("connection lost");
    await expect(getUsageBreakdown({ range: "7d", now: NOW })).resolves.toBeUndefined();
  });
});

describe("getDashboardKpis", () => {
  it("maps the single aggregate row, coercing string counts", async () => {
    fake.state.recordset = [{ chats: "3", quizAnswers: 12 }];
    await expect(getDashboardKpis({ range: "24h", now: NOW })).resolves.toEqual({
      chats: 3,
      quizAnswers: 12,
    });
  });

  it("defaults to zero when the row is absent", async () => {
    fake.state.recordset = [];
    await expect(getDashboardKpis({ range: "24h", now: NOW })).resolves.toEqual({
      chats: 0,
      quizAnswers: 0,
    });
  });

  it("returns undefined instead of throwing when the query fails", async () => {
    fake.state.executeError = new Error("connection lost");
    await expect(getDashboardKpis({ range: "24h", now: NOW })).resolves.toBeUndefined();
  });
});
