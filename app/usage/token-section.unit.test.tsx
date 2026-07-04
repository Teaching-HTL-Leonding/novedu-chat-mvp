// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenBucket } from "@/lib/usage-range";

// `TokenSection` reads the time series ONCE and renders both the (stubbed here) bar
// chart and the shared server `ListTable` from it. Assert the table reflects the
// data and that a failed read degrades to the "unavailable" copy (the store returns
// `undefined`, never throws). The client Recharts child is stubbed so this stays a
// hermetic node render. No DB, runs in CI.

const getTokenTimeSeries = vi.hoisted(() => vi.fn());

vi.mock("@/lib/usage-stats-store", () => ({ getTokenTimeSeries }));
vi.mock("./token-usage-bar-chart", () => ({
  TokenUsageBarChart: () => <div data-testid="bar-chart" />,
}));

import { TokenSection } from "./token-section";

const bucket = (
  label: string,
  inputNew: number,
  inputCached: number,
  output: number,
): TokenBucket => ({
  key: label,
  label,
  inputNew,
  inputCached,
  output,
});

async function render() {
  return renderToStaticMarkup(
    await TokenSection({ range: "24h", now: new Date("2026-07-04T14:30:00Z") }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("renders the bar chart and a table row with the summed total", async () => {
  getTokenTimeSeries.mockResolvedValue([bucket("14:00", 1000, 2500, 500)]);
  const html = await render();
  expect(html).toContain("bar-chart");
  expect(html).toContain("New input"); // table header
  expect(html).toContain("Total"); // table header
  expect(html).toContain("14:00"); // the bucket label
  expect(html).toContain("2,500"); // cached input, en-US grouped
  expect(html).toContain("4,000"); // total = 1000 + 2500 + 500
});

describe("degraded", () => {
  it("shows the unavailable copy when the read fails", async () => {
    getTokenTimeSeries.mockResolvedValue(undefined);
    const html = await render();
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("bar-chart");
  });
});
