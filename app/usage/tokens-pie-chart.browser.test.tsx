import { describe, expect, test } from "vitest";
import { OTHER_KEY, OTHER_LABEL, type Slice } from "@/lib/usage-range";
import { renderChart } from "@/tests/render-chart";
import { TokensPieChart } from "./tokens-pie-chart";

// Pure-prop rendering of the donut used for both pies — no infra, no @live tag.

const codeSlices: Slice[] = [
  { key: "c1", label: "Algebra class", total: 5000 },
  { key: "c2", label: "History class", total: 1200 },
  { key: OTHER_KEY, label: OTHER_LABEL, total: 400 },
];

describe("TokensPieChart", () => {
  test("labels each code slice (incl. the folded Other) in the legend", async () => {
    const screen = await renderChart(<TokensPieChart slices={codeSlices} variant="code" />, 420);
    await expect.element(screen.getByText("Algebra class")).toBeVisible();
    await expect.element(screen.getByText("History class")).toBeVisible();
    await expect.element(screen.getByText("Other")).toBeVisible();
  });

  test("renders an on-slice percentage for a slice ≥6%", async () => {
    // 5000/6600 ≈ 76%: the label must paint INSIDE the ring. (A bare-string Recharts
    // label would be placed outside the container and clipped — see the component.)
    const screen = await renderChart(<TokensPieChart slices={codeSlices} variant="code" />, 420);
    await expect.element(screen.getByText("76%")).toBeVisible();
  });

  test("renders module slices for the module variant", async () => {
    const moduleSlices: Slice[] = [
      { key: "tutor", label: "Tutor", total: 900 },
      { key: "quiz", label: "Quiz", total: 300 },
    ];
    const screen = await renderChart(
      <TokensPieChart slices={moduleSlices} variant="module" />,
      420,
    );
    await expect.element(screen.getByText("Tutor")).toBeVisible();
    await expect.element(screen.getByText("Quiz")).toBeVisible();
  });
});
