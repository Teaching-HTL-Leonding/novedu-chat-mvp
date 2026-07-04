"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TokenBucket } from "@/lib/usage-range";
import {
  resolveChartColors,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./_charts/chart-colors";
import { formatCompact, formatCount } from "./_charts/format";
import { legendText } from "./_charts/legend";

// Reusable stacked token-usage bar chart (docs/dashboard.md). Presentation-only —
// the data (already bucketed + zero-filled by lib/usage-stats-store, UTC labels) is
// passed as props, so the same component serves the dashboard now and the future
// single-code stats pages. Series colors come from the `--chart-*` tokens; the
// chrome (grid/axis/legend) uses `currentColor` + opacity off the foreground ramp,
// so there is no bare hex here (docs/styling.md). The companion table below the
// chart is the dataviz "relief" for the two sub-3:1 hues.

// Stack order (bottom → top) and their token slots.
const SERIES = [
  { dataKey: "inputNew", name: "New input", slot: 0 },
  { dataKey: "inputCached", name: "Cached input", slot: 1 },
  { dataKey: "output", name: "Output", slot: 7 },
] as const;

export function TokenUsageBarChart({ data }: { data: TokenBucket[] }) {
  // Read the CSS tokens on every render (cheap) rather than freezing the first read
  // in a `useMemo([])` — a client render self-corrects an empty SSR read.
  const colors = resolveChartColors();
  return (
    <div className="h-72 w-full text-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.2 }}
            tick={{ fill: "currentColor", fillOpacity: 0.6, fontSize: 12 }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            width={48}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "currentColor", fillOpacity: 0.6, fontSize: 12 }}
            tickFormatter={formatCompact}
          />
          <Tooltip
            cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            labelFormatter={(label) => `${label} UTC`}
            formatter={(value, name) => [formatCount(Number(value)), name]}
          />
          <Legend formatter={legendText} wrapperStyle={{ fontSize: "0.75rem" }} />
          {SERIES.map((s, i) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              stackId="tokens"
              name={s.name}
              fill={colors.series[s.slot]}
              maxBarSize={56}
              // Round only the top segment of the stack.
              radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
