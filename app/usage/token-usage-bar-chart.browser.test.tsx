import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
// Load the app stylesheet so the chart's `h-72` sizing (and the `--chart-*` tokens
// the series colors resolve from) apply — Recharts' ResponsiveContainer needs a
// measured parent, and the component project does not auto-load globals.css.
import "@/app/globals.css";
import type { TokenBucket } from "@/lib/usage-range";
import { TokenUsageBarChart } from "./token-usage-bar-chart";

// Pure-prop rendering of the reusable stacked bar chart — no infra, no @live tag.

const data: TokenBucket[] = [
  { key: "a", label: "12:00", inputNew: 100, inputCached: 200, output: 50 },
  { key: "b", label: "13:00", inputNew: 0, inputCached: 0, output: 0 },
  { key: "c", label: "14:00", inputNew: 300, inputCached: 100, output: 80 },
];

function Sized({ children }: { children: ReactNode }) {
  return (
    <div data-testid="chart-frame" style={{ width: 640 }}>
      {children}
    </div>
  );
}

describe("TokenUsageBarChart", () => {
  test("labels the three stacked series in the legend", async () => {
    const screen = await render(
      <Sized>
        <TokenUsageBarChart data={data} />
      </Sized>,
    );
    // Park the cursor on document.body: if the ResponsiveContainer sizes the bars
    // under a static pointer, Recharts opens the tooltip, whose item-name span
    // duplicates the legend label and trips strict-mode. `unhover` moves the cursor
    // to body regardless of target, so only the legend text remains.
    await screen.getByTestId("chart-frame").unhover();
    await expect.element(screen.getByText("New input")).toBeVisible();
    await expect.element(screen.getByText("Cached input")).toBeVisible();
    await expect.element(screen.getByText("Output", { exact: true })).toBeVisible();
  });

  test("renders an x-axis tick for a bucket label", async () => {
    const screen = await render(
      <Sized>
        <TokenUsageBarChart data={data} />
      </Sized>,
    );
    await expect.element(screen.getByText("14:00").first()).toBeVisible();
  });
});
