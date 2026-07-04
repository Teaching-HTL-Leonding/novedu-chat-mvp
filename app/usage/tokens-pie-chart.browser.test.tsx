import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
// See token-usage-bar-chart.browser.test.tsx — load globals.css so `h-72` + the
// `--chart-*` tokens apply for the ResponsiveContainer to measure and paint.
import "@/app/globals.css";
import { OTHER_KEY, OTHER_LABEL, type Slice } from "@/lib/usage-range";
import { TokensPieChart } from "./tokens-pie-chart";

// Pure-prop rendering of the donut used for both pies — no infra, no @live tag.

const codeSlices: Slice[] = [
  { key: "c1", label: "Algebra class", total: 5000 },
  { key: "c2", label: "History class", total: 1200 },
  { key: OTHER_KEY, label: OTHER_LABEL, total: 400 },
];

function Sized({ children }: { children: ReactNode }) {
  return (
    <div data-testid="chart-frame" style={{ width: 420 }}>
      {children}
    </div>
  );
}

describe("TokensPieChart", () => {
  test("labels each code slice (incl. the folded Other) in the legend", async () => {
    const screen = await render(
      <Sized>
        <TokensPieChart slices={codeSlices} variant="code" />
      </Sized>,
    );
    // Reset the pointer to body: the pie's tooltip formatter also renders the slice
    // name, so an accidentally-open tooltip would duplicate the legend label and
    // trip strict-mode (see the bar chart's test for the same guard).
    await screen.getByTestId("chart-frame").unhover();
    await expect.element(screen.getByText("Algebra class")).toBeVisible();
    await expect.element(screen.getByText("History class")).toBeVisible();
    await expect.element(screen.getByText("Other")).toBeVisible();
  });

  test("renders an on-slice percentage for a slice ≥6%", async () => {
    // 5000/6600 ≈ 76%: the label must paint INSIDE the ring. (A bare-string Recharts
    // label would be placed outside the container and clipped — see the component.)
    const screen = await render(
      <Sized>
        <TokensPieChart slices={codeSlices} variant="code" />
      </Sized>,
    );
    await expect.element(screen.getByText("76%")).toBeVisible();
  });

  test("renders module slices for the module variant", async () => {
    const moduleSlices: Slice[] = [
      { key: "tutor", label: "Tutor", total: 900 },
      { key: "quiz", label: "Quiz", total: 300 },
    ];
    const screen = await render(
      <Sized>
        <TokensPieChart slices={moduleSlices} variant="module" />
      </Sized>,
    );
    await screen.getByTestId("chart-frame").unhover();
    await expect.element(screen.getByText("Tutor")).toBeVisible();
    await expect.element(screen.getByText("Quiz")).toBeVisible();
  });
});
