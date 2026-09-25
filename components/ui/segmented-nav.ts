import { cva } from "class-variance-authority";

// The segmented link group of the chart pages' time filters (the usage
// dashboard's range tabs, the diagnostics presets): a carded row of links, the
// current one inked. It is navigation — a `<nav>` of `<Link>`s with `aria-current`
// on the active one, NOT an ARIA tablist. Consumers add placement as a cn() delta.
export const SEGMENTED_NAV =
  "inline-flex flex-wrap gap-1 rounded-lg border border-foreground/15 bg-card p-1";

export const segmentedItemVariants = cva(
  "rounded-md px-3 py-1.5 font-medium text-sm transition-colors",
  {
    variants: {
      active: {
        true: "bg-foreground text-background",
        false: "text-foreground/70 hover:bg-foreground/5",
      },
    },
    defaultVariants: { active: false },
  },
);
