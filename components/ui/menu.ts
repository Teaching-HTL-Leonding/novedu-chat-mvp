// The shared dropdown menu recipes for the two popover menus (nav-menu's
// burger navigation and user-menu's account menu, both anchored by
// use-popover.ts). Consumers add their side (left-0 / right-0) and min-width
// as cn() deltas.
// `text-foreground` is explicit: the panels drop from the dark status bar and
// must not inherit its white ink.
export const MENU_PANEL =
  "absolute top-full z-50 mt-1.5 rounded-lg border border-foreground/15 bg-background p-1 text-foreground shadow-lg";

// One menu row (a <Link> or a form's submit button); block-level so the hover
// wash fills the panel width.
export const MENU_ITEM = "block cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-foreground/5";
