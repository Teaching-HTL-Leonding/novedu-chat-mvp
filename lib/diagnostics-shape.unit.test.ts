// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  type HostMap,
  type QueryResult,
  shapeErrorBreakdown,
  shapeFailedCalls,
  shapeImpact,
  shapeLlm,
  sortProviders,
} from "@/lib/diagnostics-shape";

// Canned App Insights result tables → the page DTO. The tables mirror what the
// real endpoint returns (column names/types verified live; docs/diagnostics.md).

const HOSTS: HostMap = { "llm2go-api.scch.at": "SCCH", "openrouter.ai": "OpenRouter" };
const RANGE = {
  binKeys: ["2026-09-25T07:00:00.000Z", "2026-09-25T07:05:00.000Z", "2026-09-25T07:10:00.000Z"],
};

function table(columns: string[], rows: unknown[][]): QueryResult {
  return { ok: true, table: { columns: columns.map((name) => ({ name, type: "" })), rows } };
}

const LLM_COLUMNS = [
  "t",
  "host",
  "rows",
  "calls",
  "ok",
  "rateLimited",
  "clientError",
  "serverError",
  "noResponse",
  "p50",
  "p95",
  "maxWait",
];

// t, host, rows, calls, ok, 429, 4xx, 5xx, none, p50, p95, max
const LLM_ROWS: unknown[][] = [
  [null, "llm2go-api.scch.at", 31, 70, 60, 0, 0, 10, 0, 13587.3, 25297.8, 31175.6],
  ["2026-09-25T07:00:00Z", "llm2go-api.scch.at", 4, 5, 5, 0, 0, 0, 0, 6174.4, 20294.6, 20294.6],
  ["2026-09-25T07:10:00Z", "llm2go-api.scch.at", 27, 65, 55, null, 0, 10, 0, 15100, 25668, 31175.6],
  [null, "openrouter.ai", 2, 2, 1, 0, 0, 0, 1, 900, 1200, 1300],
  ["2026-09-25T07:05:00Z", "openrouter.ai", 2, 2, 1, 0, 0, 0, 1, 900, 1200, 1300],
];

describe("shapeLlm", () => {
  it("builds per-provider totals, zero-filled series and the sampling note", () => {
    const s = shapeLlm(table(LLM_COLUMNS, LLM_ROWS), RANGE, HOSTS);
    if (s.state !== "ok") throw new Error(s.state);
    const [scch, openrouter] = s.data.providers;
    expect(scch).toEqual({
      provider: "SCCH",
      rows: 31,
      calls: 70,
      errors: 10,
      failed: 10,
      errorRate: 10 / 70,
      p50Ms: 13587.3,
      p95Ms: 25297.8,
      maxMs: 31175.6,
    });
    // A call without response counts as an error.
    expect(openrouter).toMatchObject({ provider: "OpenRouter", errors: 1, errorRate: 0.5 });

    const bins = s.data.series[0]?.bins ?? [];
    expect(bins.map((b) => b.key)).toEqual(RANGE.binKeys);
    expect(bins[1]).toMatchObject({ calls: 0, errors: 0, p50Ms: null, p95Ms: null });
    // A null `sumif` reads as 0; a 503 is a serverError regardless of `success`.
    expect(bins[2]).toMatchObject({ calls: 65, rateLimited: 0, serverError: 10, errors: 10 });
    expect(bins[2]?.t).toBe(Date.parse("2026-09-25T07:10:00Z"));

    expect(s.data.sampling).toEqual({ rows: 33, estimated: 72, ratio: 33 / 72 });
    expect(s.data.totalFailed).toBe(11);
  });

  it("maps unknown hosts to other, sorted last, and merges them", () => {
    const rows = [
      [null, "a.example", 1, 3, 3, 0, 0, 0, 0, 100, 200, 300],
      [null, "b.example", 1, 2, 1, 1, 0, 0, 0, 500, 900, 950],
      [null, "llm2go-api.scch.at", 1, 1, 1, 0, 0, 0, 0, 10, 20, 30],
    ];
    const s = shapeLlm(table(LLM_COLUMNS, rows), RANGE, HOSTS);
    if (s.state !== "ok") throw new Error(s.state);
    expect(s.data.providers.map((p) => p.provider)).toEqual(["SCCH", "other"]);
    expect(s.data.providers[1]).toMatchObject({
      calls: 5,
      errors: 1,
      p50Ms: 500,
      p95Ms: 900,
      maxMs: 950,
    });
  });

  it("reads columns by name, in any order", () => {
    const order = [...LLM_COLUMNS].reverse();
    const rows = LLM_ROWS.map((r) => [...r].reverse());
    const s = shapeLlm(table(order, rows), RANGE, HOSTS);
    if (s.state !== "ok") throw new Error(s.state);
    expect(s.data.providers[0]?.calls).toBe(70);
  });

  it("is unavailable on a missing column, empty on no rows, and passes failures through", () => {
    expect(shapeLlm(table(LLM_COLUMNS.slice(1), []), RANGE, HOSTS)).toEqual({
      state: "unavailable",
      failure: "error",
    });
    expect(shapeLlm(table(LLM_COLUMNS, []), RANGE, HOSTS)).toEqual({ state: "empty" });
    expect(shapeLlm({ ok: false, failure: "timeout" }, RANGE, HOSTS)).toEqual({
      state: "unavailable",
      failure: "timeout",
    });
  });
});

const BREAKDOWN_COLUMNS = ["host", "resultCode", "errors", "medianWait", "firstSeen", "lastSeen"];

describe("shapeErrorBreakdown", () => {
  it("maps hosts, sorts by count and marks a full result as capped", () => {
    const s = shapeErrorBreakdown(
      table(BREAKDOWN_COLUMNS, [
        ["openrouter.ai", "", 1, 900, "2026-09-25T07:05:00Z", "2026-09-25T07:05:00Z"],
        [
          "llm2go-api.scch.at",
          "503",
          10,
          15122.5,
          "2026-09-25T07:28:04.08Z",
          "2026-09-25T07:47:33.323Z",
        ],
      ]),
      HOSTS,
    );
    if (s.state !== "ok") throw new Error(s.state);
    expect(s.data.capped).toBe(false);
    expect(s.data.rows[0]).toEqual({
      provider: "SCCH",
      resultCode: "503",
      count: 10,
      medianMs: 15122.5,
      firstSeen: "2026-09-25T07:28:04.080Z",
      lastSeen: "2026-09-25T07:47:33.323Z",
    });
    expect(s.data.rows[1]).toMatchObject({ provider: "OpenRouter", resultCode: "" });

    const full = Array.from({ length: 20 }, (_, i) => [
      "llm2go-api.scch.at",
      String(500 + i),
      1,
      1,
      "2026-09-25T07:00:00Z",
      "2026-09-25T07:00:00Z",
    ]);
    const capped = shapeErrorBreakdown(table(BREAKDOWN_COLUMNS, full), HOSTS);
    expect(capped.state === "ok" && capped.data.capped).toBe(true);
  });
});

describe("shapeFailedCalls", () => {
  it("keeps the sample newest first with its weights", () => {
    const s = shapeFailedCalls(
      table(
        ["timestamp", "host", "resultCode", "outcome", "duration", "itemCount"],
        [
          ["2026-09-25T07:38:02.153Z", "llm2go-api.scch.at", "503", "serverError", 15152.4, 4],
          ["2026-09-25T07:47:33.323Z", "llm2go-api.scch.at", "0", "noResponse", 30000, 1],
        ],
      ),
      HOSTS,
    );
    if (s.state !== "ok") throw new Error(s.state);
    expect(s.data.rows.map((r) => [r.time, r.outcome, r.itemCount])).toEqual([
      ["2026-09-25T07:47:33.323Z", "noResponse", 1],
      ["2026-09-25T07:38:02.153Z", "serverError", 4],
    ]);
    expect(s.data.capped).toBe(false);
  });
});

const FAILURE_COLUMNS = ["t", "module", "failure", "code", "failed"];
const TURN_COLUMNS = ["t", "turns", "p95"];

describe("shapeImpact", () => {
  const turns = table(TURN_COLUMNS, [
    [null, 51, 44500],
    ["2026-09-25T07:05:00Z", 10, 40000],
  ]);

  it("groups failures by module and code (else failure kind) and zero-fills bins", () => {
    const failures = table(FAILURE_COLUMNS, [
      ["2026-09-25T07:05:00Z", "tutor", "run-error-event", "INCOMPLETE_STREAM", 4],
      ["2026-09-25T07:10:00Z", "tutor", "run-error-event", "INCOMPLETE_STREAM", 2],
      ["2026-09-25T07:10:00Z", "quiz", "stream-error", "", 1],
    ]);
    const s = shapeImpact(failures, turns, RANGE);
    if (s.state !== "ok") throw new Error(s.state);
    expect(s.data).toMatchObject({ failedTurns: 7, turns: 51, turnP95Ms: 44500 });
    expect(s.data.failedShare).toBeCloseTo(7 / 51);
    expect(s.data.groups).toEqual([
      { module: "tutor", label: "INCOMPLETE_STREAM", count: 6 },
      { module: "quiz", label: "stream-error", count: 1 },
    ]);
    expect(s.data.bins.map((b) => [b.failedTurns, b.turns, b.p95Ms])).toEqual([
      [0, 0, null],
      [4, 10, 40000],
      [3, 0, null],
    ]);
  });

  it("has no share without turns and is empty without turns or failures", () => {
    const noTurns = table(TURN_COLUMNS, []);
    const one = table(FAILURE_COLUMNS, [["2026-09-25T07:05:00Z", "tutor", "stream-error", "", 1]]);
    const s = shapeImpact(one, noTurns, RANGE);
    expect(s.state === "ok" && s.data.failedShare).toBeNull();
    expect(shapeImpact(table(FAILURE_COLUMNS, []), noTurns, RANGE)).toEqual({ state: "empty" });
  });

  it("is unavailable when either query failed", () => {
    expect(shapeImpact({ ok: false, failure: "forbidden" }, turns, RANGE)).toEqual({
      state: "unavailable",
      failure: "forbidden",
    });
    expect(
      shapeImpact(table(FAILURE_COLUMNS, []), { ok: false, failure: "timeout" }, RANGE),
    ).toEqual({ state: "unavailable", failure: "timeout" });
  });
});

describe("sortProviders", () => {
  it("orders by the provider list with other last", () => {
    const xs = [{ provider: "other" }, { provider: "OpenRouter" }, { provider: "SCCH" }] as const;
    expect(sortProviders(xs).map((x) => x.provider)).toEqual(["SCCH", "OpenRouter", "other"]);
  });
});
