// The shared modal <dialog> recipe (writing lightboxes, quiz discussion,
// teacher transcript lightbox). Class strings, not a component: each surface
// owns its open/close behavior and inner layout; only the look is shared.
// `m-auto` is load-bearing — Tailwind preflight zeroes the UA dialog margin
// that centers native modals in the top layer.
export const DIALOG_SHELL =
  "m-auto h-[80vh] w-[min(48rem,92vw)] max-w-[92vw] overflow-hidden rounded-xl border border-foreground/15 bg-background p-0 text-foreground backdrop:bg-foreground/45";

export const DIALOG_HEADER =
  "flex items-center justify-between gap-4 border-foreground/15 border-b px-4 py-3";

export const DIALOG_BODY = "min-h-0 flex-1 overflow-y-auto p-4";
