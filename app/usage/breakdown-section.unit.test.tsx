// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { UsageBreakdown } from "@/lib/usage-stats-store";

// `BreakdownSection` reads the breakdown ONCE and feeds both pies. Assert it maps
// the raw module id to its display badge (`withModuleLabels`), and that the
// empty-range and failed-read branches render the right copy. The client Recharts
// pie is stubbed so this stays a hermetic node render. No DB, runs in CI.

const getUsageBreakdown = vi.hoisted(() => vi.fn());

vi.mock("@/lib/usage-stats-store", () => ({ getUsageBreakdown }));
vi.mock("./tokens-pie-chart", () => ({
  TokensPieChart: ({ slices }: { slices: { label: string }[] }) => (
    <div data-testid="pie">{slices.map((s) => s.label).join(",")}</div>
  ),
}));

import { BreakdownSection } from "./breakdown-section";

async function render(breakdown: UsageBreakdown | undefined) {
  getUsageBreakdown.mockResolvedValue(breakdown);
  return renderToStaticMarkup(
    await BreakdownSection({ range: "7d", now: new Date("2026-07-04T14:30:00Z") }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("maps raw module ids to their display badges and labels code slices", async () => {
  const html = await render({
    byModule: [
      { key: "quiz", label: "quiz", total: 100 },
      { key: "tutor", label: "tutor", total: 50 },
    ],
    byCode: [{ key: "c1", label: "Algebra", total: 90 }],
  });
  // The raw module id "quiz" is shown as its badge "Quiz", not verbatim.
  expect(html).toContain("Quiz");
  expect(html).toContain("Tutor");
  expect(html).toContain("Algebra");
});

it("shows the empty-range copy when a pie has no slices", async () => {
  const html = await render({ byModule: [], byCode: [] });
  expect(html).toContain("No usage in this range");
});

it("degrades to the unavailable copy when the read fails", async () => {
  const html = await render(undefined);
  expect(html).toContain("could not be loaded");
  expect(html).not.toContain("No usage in this range");
});
