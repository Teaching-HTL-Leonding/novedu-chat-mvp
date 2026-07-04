"use client";

// Shared Recharts legend renderer for the dashboard charts. Recharts renders the
// legend as HTML, so a CSS custom property DOES resolve here — the label keeps the
// app foreground ink (no bare hex; docs/styling.md) instead of Recharts' default.
export const legendText = (value: string) => (
  <span style={{ color: "var(--color-foreground)" }}>{value}</span>
);
