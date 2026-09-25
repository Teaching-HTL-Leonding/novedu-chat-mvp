import type { ReactNode } from "react";
import { render } from "vitest-browser-react";
// The component project does not auto-load the app stylesheet; the chart frame's
// `h-*` sizing and the `--chart-*` tokens the series colors resolve from need it —
// Recharts' ResponsiveContainer measures its parent.
import "@/app/globals.css";

// Shared browser-test harness for the Recharts charts (usage, diagnostics): renders
// the chart in a fixed-width frame, then parks the pointer on document.body. If the
// chart lays out under a static pointer, Recharts opens its tooltip, whose item
// names duplicate the legend labels and trip strict-mode `getByText` — `unhover`
// moves the cursor to body regardless of target, so only the legend text remains.
export async function renderChart(chart: ReactNode, width = 640) {
  const screen = await render(
    <div data-testid="chart-frame" style={{ width }}>
      {chart}
    </div>,
  );
  await screen.getByTestId("chart-frame").unhover();
  return screen;
}
