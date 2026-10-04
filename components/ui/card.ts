import { cva } from "class-variance-authority";

// The app's content card: the hairline-bordered surface on the gray page canvas
// (PAGE_CANVAS). Shared by the start page's sections, the Settings page, the quiz
// runner's cards and the writing surface. `pad` picks the inner padding:
// `section` for a page section (tighter on phones), `compact` for an inline card
// inside a column; `none` when the card's children pad themselves. Consumed via
// cn() for layout deltas.
/** A page section's padding — also for a card's inner panes (the start page's progress card). */
export const CARD_SECTION_PAD = "px-4 py-5 md:px-6";

export const cardVariants = cva("rounded-xl border border-foreground/15 bg-card", {
  variants: {
    pad: {
      none: "",
      section: CARD_SECTION_PAD,
      compact: "px-5 py-4",
    },
  },
  defaultVariants: { pad: "none" },
});
