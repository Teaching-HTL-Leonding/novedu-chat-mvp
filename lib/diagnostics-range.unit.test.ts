// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  binStarts,
  chooseBin,
  floorToBin,
  isValidTimeZone,
  MAX_RANGE_MS,
  parseDiagnosticsParams,
  type RangeParse,
  type ResolvedRange,
  resolvePreset,
  validateCustomRange,
  zonedMidnightUtc,
} from "@/lib/diagnostics-range";

// Pure window resolution for the diagnostics page — `now` injected, zones resolved
// by Node's full ICU, so every assertion is deterministic.

const iso = (d: Date) => d.toISOString();
const H = 3_600_000;

function resolved(parse: RangeParse): { range: ResolvedRange; notice?: string } {
  if (parse.kind !== "resolved") throw new Error(`expected resolved, got ${parse.kind}`);
  return parse;
}

describe("resolvePreset", () => {
  const now = new Date("2026-09-25T09:15:42Z");

  it("today = local midnight → now (Vienna, UTC+2 in September)", () => {
    const { from, to } = resolvePreset("today", "Europe/Vienna", now);
    expect(iso(from)).toBe("2026-09-24T22:00:00.000Z");
    expect(to).toBe(now);
  });

  it("yesterday = the whole previous local day", () => {
    const { from, to } = resolvePreset("yesterday", "Europe/Vienna", now);
    expect(iso(from)).toBe("2026-09-23T22:00:00.000Z");
    expect(iso(to)).toBe("2026-09-24T22:00:00.000Z");
  });

  it("today and yesterday carry the bin of their span", () => {
    expect(resolvePreset("today", "Europe/Vienna", now).bin).toBe("5m");
    expect(resolvePreset("yesterday", "Europe/Vienna", now).bin).toBe("5m");
  });

  describe("last7d = a rolling 7 × 24 h ending now, its start floored to the 1 h bin", () => {
    // Non-zero minutes, seconds and ms, so the flooring is actually exercised.
    const odd = new Date("2026-09-25T09:47:15.123Z");

    it("floors to the local hour (Vienna, UTC+2)", () => {
      const { from, to, bin } = resolvePreset("last7d", "Europe/Vienna", odd);
      // Nominal start 2026-09-18T09:47:15.123Z = 11:47 local → 11:00 local.
      expect(iso(from)).toBe("2026-09-18T09:00:00.000Z");
      expect(to).toBe(odd);
      expect(bin).toBe("1h");
    });

    it("floors to the local hour in a half-hour zone (Kolkata, UTC+5:30)", () => {
      const { from, to, bin } = resolvePreset("last7d", "Asia/Kolkata", odd);
      // Nominal start 09:47:15Z = 15:17 local → 15:00 local = 09:30Z.
      expect(iso(from)).toBe("2026-09-18T09:30:00.000Z");
      expect(to).toBe(odd);
      expect(bin).toBe("1h");
    });

    it("never starts later than the nominal 7 × 24 h, and at most one bin earlier", () => {
      for (const tz of ["Europe/Vienna", "Asia/Kolkata", "Pacific/Chatham", "UTC"]) {
        const { from } = resolvePreset("last7d", tz, odd);
        const nominal = odd.getTime() - 7 * 24 * H;
        expect(from.getTime()).toBeLessThanOrEqual(nominal);
        expect(nominal - from.getTime()).toBeLessThan(H);
      }
    });

    it("leaves an already aligned start in place", () => {
      const aligned = new Date("2026-09-25T09:00:00Z");
      expect(iso(resolvePreset("last7d", "Europe/Vienna", aligned).from)).toBe(
        "2026-09-18T09:00:00.000Z",
      );
    });
  });

  it("resolves west-of-UTC, half-hour and quarter-hour zones", () => {
    expect(iso(resolvePreset("today", "America/New_York", now).from)).toBe(
      "2026-09-25T04:00:00.000Z",
    );
    expect(iso(resolvePreset("today", "Asia/Kolkata", now).from)).toBe("2026-09-24T18:30:00.000Z");
    // Chatham is UTC+12:45 in (southern) spring: 09:15Z is already 22:00 local.
    expect(iso(resolvePreset("today", "Pacific/Chatham", now).from)).toBe(
      "2026-09-24T11:15:00.000Z",
    );
    expect(iso(resolvePreset("today", "UTC", now).from)).toBe("2026-09-25T00:00:00.000Z");
  });

  it("picks the local date, not the UTC date, near midnight", () => {
    // 23:30Z on the 24th is already the 25th in Vienna.
    const late = new Date("2026-09-24T23:30:00Z");
    expect(iso(resolvePreset("today", "Europe/Vienna", late).from)).toBe(
      "2026-09-24T22:00:00.000Z",
    );
    expect(iso(resolvePreset("today", "UTC", late).from)).toBe("2026-09-24T00:00:00.000Z");
  });

  it("the spring-forward day is 23 h long (Vienna, 2026-03-29)", () => {
    const { from, to } = resolvePreset(
      "yesterday",
      "Europe/Vienna",
      new Date("2026-03-30T08:00:00Z"),
    );
    expect(iso(from)).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(to)).toBe("2026-03-29T22:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(23 * H);
  });

  it("the fall-back day is 25 h long (Vienna, 2026-10-25)", () => {
    const { from, to } = resolvePreset(
      "yesterday",
      "Europe/Vienna",
      new Date("2026-10-26T08:00:00Z"),
    );
    expect(iso(from)).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(to)).toBe("2026-10-25T23:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(25 * H);
  });
});

describe("floorToBin", () => {
  it("floors to a bin counted from UTC midnight without a zone", () => {
    expect(iso(floorToBin(new Date("2026-09-24T09:47:15.123Z"), "5m"))).toBe(
      "2026-09-24T09:45:00.000Z",
    );
    expect(iso(floorToBin(new Date("2026-09-24T09:47:15.123Z"), "6h"))).toBe(
      "2026-09-24T06:00:00.000Z",
    );
  });

  it("counts from local midnight in a zone, across a DST switch (Vienna, 2026-10-25)", () => {
    // Local midnight is 2026-10-24T22:00Z; the day has 25 h, the hours stay whole.
    expect(iso(floorToBin(new Date("2026-10-25T05:20:00Z"), "1h", "Europe/Vienna"))).toBe(
      "2026-10-25T05:00:00.000Z",
    );
  });

  it("returns a boundary unchanged", () => {
    const at = new Date("2026-09-24T18:30:00Z");
    expect(floorToBin(at, "1h", "Asia/Kolkata").getTime()).toBe(at.getTime());
  });
});

describe("zonedMidnightUtc", () => {
  it("handles the DST switch day itself", () => {
    expect(iso(zonedMidnightUtc({ year: 2026, month: 3, day: 29 }, "Europe/Vienna"))).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(iso(zonedMidnightUtc({ year: 2026, month: 3, day: 30 }, "Europe/Vienna"))).toBe(
      "2026-03-29T22:00:00.000Z",
    );
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects anything else", () => {
    expect(isValidTimeZone("Europe/Vienna")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe("validateCustomRange", () => {
  const now = new Date("2026-09-25T09:00:00Z");

  it("accepts a valid window", () => {
    const r = validateCustomRange("2026-09-25T07:00:00Z", "2026-09-25T08:30:00Z", now);
    expect(r).toEqual({
      ok: true,
      from: new Date("2026-09-25T07:00:00Z"),
      to: new Date("2026-09-25T08:30:00Z"),
    });
  });

  it("clamps `to` to now", () => {
    const r = validateCustomRange("2026-09-25T07:00:00Z", "2026-09-26T00:00:00Z", now);
    expect(r).toEqual({ ok: true, from: new Date("2026-09-25T07:00:00Z"), to: now });
  });

  it("rejects unparsable, inverted, future-only and over-long windows", () => {
    expect(validateCustomRange("nope", "2026-09-25T08:00:00Z", now)).toEqual({
      ok: false,
      reason: "unparsable",
    });
    expect(validateCustomRange(undefined, "2026-09-25T08:00:00Z", now)).toEqual({
      ok: false,
      reason: "unparsable",
    });
    expect(validateCustomRange("2026-09-25T08:00:00Z", "2026-09-25T08:00:00Z", now)).toEqual({
      ok: false,
      reason: "from-not-before-to",
    });
    // Starts in the future: after clamping `to` it no longer ends after `from`.
    expect(validateCustomRange("2026-09-25T10:00:00Z", "2026-09-25T11:00:00Z", now)).toEqual({
      ok: false,
      reason: "from-not-before-to",
    });
    const from = new Date(now.getTime() - MAX_RANGE_MS - 60_000).toISOString();
    expect(validateCustomRange(from, now.toISOString(), now)).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("allows exactly 31 days", () => {
    const from = new Date(now.getTime() - MAX_RANGE_MS).toISOString();
    expect(validateCustomRange(from, now.toISOString(), now).ok).toBe(true);
  });
});

describe("chooseBin", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 1) + h * H);
  const start = at(0);

  it("uses the thresholds inclusively", () => {
    expect(chooseBin(start, at(3))).toBe("1m");
    expect(chooseBin(start, new Date(at(3).getTime() + 1))).toBe("5m");
    expect(chooseBin(start, at(24))).toBe("5m");
    expect(chooseBin(start, new Date(at(24).getTime() + 1))).toBe("1h");
    expect(chooseBin(start, at(7 * 24))).toBe("1h");
    expect(chooseBin(start, new Date(at(7 * 24).getTime() + 1))).toBe("6h");
  });
});

describe("binStarts", () => {
  it("steps from `from` (not a clock boundary) and stops before `to`", () => {
    const from = new Date("2026-09-25T07:02:30Z");
    const to = new Date("2026-09-25T07:17:30Z");
    expect(binStarts(from, to, "5m").map(iso)).toEqual([
      "2026-09-25T07:02:30.000Z",
      "2026-09-25T07:07:30.000Z",
      "2026-09-25T07:12:30.000Z",
    ]);
  });

  it("includes a partial last bin", () => {
    const from = new Date("2026-09-25T07:00:00Z");
    const to = new Date("2026-09-25T07:11:00Z");
    expect(binStarts(from, to, "5m")).toHaveLength(3);
  });
});

describe("parseDiagnosticsParams", () => {
  const now = new Date("2026-09-25T09:15:42Z");

  it("needs the browser zone when tz is absent", () => {
    expect(parseDiagnosticsParams({}, now)).toEqual({ kind: "needs-tz" });
    expect(parseDiagnosticsParams({ range: "yesterday" }, now)).toEqual({ kind: "needs-tz" });
  });

  it("resolves a preset in the given zone", () => {
    const { range, notice } = resolved(
      parseDiagnosticsParams({ range: "today", tz: "Europe/Vienna" }, now),
    );
    expect(notice).toBeUndefined();
    expect(iso(range.from)).toBe("2026-09-24T22:00:00.000Z");
    expect(range.to).toBe(now);
    expect(range.bin).toBe("5m");
    expect(range.binKeys[0]).toBe("2026-09-24T22:00:00.000Z");
    expect(range.source).toEqual({ kind: "preset", preset: "today", tz: "Europe/Vienna" });
  });

  it("defaults to Today when only tz is given", () => {
    const { range, notice } = resolved(parseDiagnosticsParams({ tz: "UTC" }, now));
    expect(notice).toBeUndefined();
    expect(range.source).toEqual({ kind: "preset", preset: "today", tz: "UTC" });
  });

  it("falls back to Today with a notice for an unknown preset", () => {
    const { range, notice } = resolved(
      parseDiagnosticsParams({ range: "forever", tz: "Europe/Vienna" }, now),
    );
    expect(range.source).toEqual({ kind: "preset", preset: "today", tz: "Europe/Vienna" });
    expect(notice).toContain("Unknown time range");
  });

  it("resolves in UTC with a notice for a present but unknown zone (no redirect loop)", () => {
    const { range, notice } = resolved(
      parseDiagnosticsParams({ range: "today", tz: "Mars/Olympus" }, now),
    );
    expect(range.source).toEqual({ kind: "preset", preset: "today", tz: "UTC" });
    expect(iso(range.from)).toBe("2026-09-25T00:00:00.000Z");
    expect(notice).toContain("UTC");
  });

  it("prefers a custom range over a preset", () => {
    const { range, notice } = resolved(
      parseDiagnosticsParams(
        { range: "today", tz: "UTC", from: "2026-09-25T07:00:00Z", to: "2026-09-25T08:30:00Z" },
        now,
      ),
    );
    expect(notice).toBeUndefined();
    expect(range.source).toEqual({ kind: "custom" });
    expect(range.bin).toBe("1m");
    expect(range.binKeys).toHaveLength(90);
  });

  it("falls back to the last 24 hours, floored to the 5 min bin in UTC, for an invalid custom range", () => {
    const odd = new Date("2026-09-25T09:47:15.123Z");
    const { range, notice } = resolved(
      parseDiagnosticsParams({ from: "2026-09-25T08:00:00Z", to: "2026-09-25T07:00:00Z" }, odd),
    );
    expect(range.source).toEqual({ kind: "custom" });
    expect(range.to).toBe(odd);
    expect(iso(range.from)).toBe("2026-09-24T09:45:00.000Z");
    // 24 h + 2 min 15 s would be "1h" by span; the nominal 24 h bin is kept.
    expect(range.bin).toBe("5m");
    expect(range.binKeys[0]).toBe("2026-09-24T09:45:00.000Z");
    expect(range.binKeys).toHaveLength(289);
    expect(range.key).toBe("2026-09-24T09:45:00.000Z_2026-09-25T09:47:15.123Z");
    expect(notice).toContain("start before it ends");
  });

  it("keeps last7d on 1 h bins after flooring (regression: 7 d + 47 min is 6 h by span)", () => {
    const odd = new Date("2026-09-25T09:47:15.123Z");
    const { range } = resolved(
      parseDiagnosticsParams({ range: "last7d", tz: "Europe/Vienna" }, odd),
    );
    expect(chooseBin(range.from, range.to)).toBe("6h");
    expect(range.bin).toBe("1h");
    expect(iso(range.from)).toBe("2026-09-18T09:00:00.000Z");
    expect(range.to).toBe(odd);
    expect(range.binKeys[0]).toBe("2026-09-18T09:00:00.000Z");
    expect(range.binKeys[1]).toBe("2026-09-18T10:00:00.000Z");
    expect(range.binKeys).toHaveLength(7 * 24 + 1);
    expect(range.key).toBe("2026-09-18T09:00:00.000Z_2026-09-25T09:47:15.123Z");
  });

  it("uses a valid custom range as given, without flooring", () => {
    const { range } = resolved(
      parseDiagnosticsParams({ from: "2026-09-25T07:02:30Z", to: "2026-09-25T08:30:00Z" }, now),
    );
    expect(iso(range.from)).toBe("2026-09-25T07:02:30.000Z");
    expect(range.binKeys[0]).toBe("2026-09-25T07:02:30.000Z");
  });

  it("rejects repeated params", () => {
    const { notice } = resolved(
      parseDiagnosticsParams(
        { from: ["2026-09-25T07:00:00Z", "x"], to: "2026-09-25T08:00:00Z" },
        now,
      ),
    );
    expect(notice).toContain("could not be read");
    const preset = resolved(parseDiagnosticsParams({ range: ["today", "last7d"], tz: "UTC" }, now));
    expect(preset.notice).toContain("Unknown time range");
  });

  it("keys the range by its instants", () => {
    const a = resolved(parseDiagnosticsParams({ range: "yesterday", tz: "UTC" }, now)).range;
    expect(a.key).toBe("2026-09-24T00:00:00.000Z_2026-09-25T00:00:00.000Z");
  });
});
