import { describe, expect, test } from "vitest";
import type { TokenBucket } from "@/lib/usage-range";
import { renderChart } from "@/tests/render-chart";
import { TokenUsageBarChart } from "./token-usage-bar-chart";

// Pure-prop rendering of the reusable stacked bar chart — no infra, no @live tag.

const data: TokenBucket[] = [
  { key: "a", label: "12:00", inputNew: 100, inputCached: 200, output: 50 },
  { key: "b", label: "13:00", inputNew: 0, inputCached: 0, output: 0 },
  { key: "c", label: "14:00", inputNew: 300, inputCached: 100, output: 80 },
];

describe("TokenUsageBarChart", () => {
  test("labels the three stacked series in the legend", async () => {
    const screen = await renderChart(<TokenUsageBarChart data={data} />);
    await expect.element(screen.getByText("New input")).toBeVisible();
    await expect.element(screen.getByText("Cached input")).toBeVisible();
    await expect.element(screen.getByText("Output", { exact: true })).toBeVisible();
  });

  test("renders an x-axis tick for a bucket label", async () => {
    const screen = await renderChart(<TokenUsageBarChart data={data} />);
    await expect.element(screen.getByText("14:00").first()).toBeVisible();
  });
});
