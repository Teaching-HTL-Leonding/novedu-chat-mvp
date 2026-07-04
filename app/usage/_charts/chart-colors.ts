"use client";

// Resolves the `--chart-*` CSS tokens (defined in app/globals.css) to concrete
// color strings for Recharts, whose SVG `fill`/`stroke` attributes do NOT resolve
// CSS custom properties. The single source of truth stays the CSS tokens
// (docs/styling.md — no bare hex in a component); this only reads them.
//
// Returns empty strings during SSR (no `document`); that is harmless because
// Recharts' ResponsiveContainer paints nothing measurable server-side — the real
// paint happens on the client, where getComputedStyle resolves the tokens.

function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface ChartColors {
  /** Categorical series colors, `--chart-1..9`. */
  series: string[];
  /** The muted "Other" slice color, `--chart-other`. */
  other: string;
  /** The chart surface, used for the 2px ring between pie slices. */
  surface: string;
}

export function resolveChartColors(): ChartColors {
  return {
    series: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => cssVar(`--chart-${i}`)),
    other: cssVar("--chart-other"),
    surface: cssVar("--background"),
  };
}

// HTML tooltip/legend chrome (Recharts renders these as HTML, so CSS custom
// properties and color-mix() DO resolve here — token-based, no bare hex).
export const TOOLTIP_CONTENT_STYLE = {
  background: "var(--color-background)",
  border: "1px solid color-mix(in oklab, var(--color-foreground) 15%, transparent)",
  borderRadius: "0.5rem",
  fontSize: "0.75rem",
  color: "var(--color-foreground)",
} as const;

export const TOOLTIP_LABEL_STYLE = { color: "var(--color-foreground)", fontWeight: 600 } as const;
