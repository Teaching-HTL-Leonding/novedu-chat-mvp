import { describe, expect, test } from "vitest";
import { INCIDENT_2026_09_25 } from "@/lib/diagnostics-report.fixture";
import { renderChart } from "@/tests/render-chart";
import { CallsByOutcomeChart } from "./calls-by-outcome-chart";
import { StudentImpactChart } from "./student-impact-chart";
import { WaitPercentilesChart } from "./wait-percentiles-chart";

// Pure-prop rendering of the three diagnostics charts with the incident fixture —
// no infra, no @live tag.

const SPAN = 4 * 3_600_000;
const llm = INCIDENT_2026_09_25.llm;
const impact = INCIDENT_2026_09_25.impact;
if (llm.state !== "ok" || impact.state !== "ok") throw new Error("fixture");
const series = llm.data.series;

describe("CallsByOutcomeChart", () => {
  test("labels every outcome in the legend", async () => {
    const screen = await renderChart(
      <CallsByOutcomeChart bins={series[0]?.bins ?? []} spanMs={SPAN} />,
      720,
    );
    for (const label of ["OK", "Other 4xx", "429 rate limited", "5xx", "No response"]) {
      await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
    }
  });
});

describe("WaitPercentilesChart", () => {
  test("draws a p50 and a p95 line per provider", async () => {
    const screen = await renderChart(<WaitPercentilesChart series={series} spanMs={SPAN} />, 720);
    await expect.element(screen.getByText("SCCH p50", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("SCCH p95", { exact: true })).toBeVisible();
    expect(screen.container.querySelectorAll(".recharts-line").length).toBe(2);
  });
});

describe("StudentImpactChart", () => {
  test("shows failed turns and the turn p95 on two axes", async () => {
    const screen = await renderChart(
      <StudentImpactChart bins={impact.data.bins} spanMs={SPAN} />,
      720,
    );
    await expect.element(screen.getByText("Failed chat turns", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Chat turn p95", { exact: true })).toBeVisible();
    expect(screen.container.querySelectorAll(".recharts-yAxis").length).toBe(2);
  });
});
