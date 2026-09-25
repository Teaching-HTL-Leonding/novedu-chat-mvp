// Fixed en-US number formatting for the chart pages (usage, diagnostics) so axes,
// tooltips, and tables read the same regardless of the viewer's locale. Pure;
// client + server safe.

/** Full grouped integer, e.g. `1,234,567`. */
export const formatCount = (n: number): string => n.toLocaleString("en-US");

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Compact form for tight axis ticks, e.g. `1.2M`. */
export const formatCompact = (n: number): string => compact.format(n);
