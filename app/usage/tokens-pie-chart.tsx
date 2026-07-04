"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CODE_MODULES } from "@/lib/code-modules/types";
import { OTHER_KEY, type Slice } from "@/lib/usage-range";
import {
  resolveChartColors,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./_charts/chart-colors";
import { formatCount } from "./_charts/format";
import { legendText } from "./_charts/legend";

// Donut used for BOTH dashboard pies (docs/dashboard.md). Color assignment differs
// by variant, so it is decided here from serializable props (a function prop can't
// cross the server→client boundary):
//   - "module": color follows the module identity (fixed CODE_MODULES order), so
//     tutor/quiz/writing/coding keep the same hue as elsewhere.
//   - "code":   color follows rank (top slices), and the folded "Other" slice is
//     the muted gray.
// Legend + tooltip carry identity (the dataviz "relief" for sub-3:1 hues); slices
// ≥6% also get an on-slice percentage.

const RADIAN = Math.PI / 180;

export function TokensPieChart({
  slices,
  variant,
}: {
  slices: Slice[];
  variant: "module" | "code";
}) {
  // Read the CSS tokens on every render (cheap): an empty read during SSR is
  // harmless (Recharts paints nothing measurable server-side) and a later client
  // render self-corrects — unlike a `useMemo([])` that would freeze an empty read.
  const colors = resolveChartColors();

  const colorFor = (slice: Slice, index: number): string => {
    if (slice.key === OTHER_KEY) return colors.other;
    if (variant === "module") {
      const moduleIndex = CODE_MODULES.indexOf(slice.key as (typeof CODE_MODULES)[number]);
      const slot = (moduleIndex >= 0 ? moduleIndex : index) % colors.series.length;
      return colors.series[slot] ?? colors.other;
    }
    return colors.series[index % colors.series.length] ?? colors.other;
  };

  // On-slice percentage, positioned INSIDE the ring: a Recharts label that returns a
  // bare string is placed OUTSIDE (outerRadius + 20px) and clips in this container,
  // so we return a positioned <text> at the ring mid-radius. SVG `fill` does not
  // resolve a CSS var, so the surface (background) color comes from the resolved
  // token. Slices under 6% are omitted (too small to label legibly).
  const renderPercent = (props: {
    cx?: number;
    cy?: number;
    midAngle?: number;
    innerRadius?: number;
    outerRadius?: number;
    percent?: number;
  }) => {
    const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0 } = props;
    if (percent < 0.06) return null;
    const r = innerRadius + (outerRadius - innerRadius) / 2;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        fill={colors.surface || "#ffffff"}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
      >
        {`${Math.round(percent * 100)}%`}
      </text>
    );
  };

  return (
    <div className="h-72 w-full text-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="total"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="88%"
            // No paddingAngle: it inserts a gap between every slice, so a single
            // ~100% slice would render as an open ring. The 2px surface stroke
            // separates adjacent real slices instead.
            stroke={colors.surface || undefined}
            strokeWidth={2}
            label={renderPercent}
            labelLine={false}
          >
            {slices.map((slice, i) => (
              <Cell key={slice.key} fill={colorFor(slice, i)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={(value, name) => [formatCount(Number(value)), name]}
          />
          <Legend formatter={legendText} wrapperStyle={{ fontSize: "0.75rem" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
