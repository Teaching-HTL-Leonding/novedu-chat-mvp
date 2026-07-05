import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The shared page shell: a max-width column that fills the remaining viewport
// height below the status bar (body is a 100dvh flex column). The vertical
// padding keeps full-height surfaces (e.g. writing) off the viewport edges
// inside main's border-box height, so it never reintroduces page overflow.
export function Main({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cn("mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col py-3", className)}
      {...props}
    />
  );
}

// The full-bleed page canvas: the gray backdrop content surfaces sit on.
// Negative margins undo Main's centered max-width (100% = Main's content
// width, 100vw = the window) and its vertical py-3, so the gray reaches the
// status bar and the window edges. Shared by PageBody (scrolling pages) and
// the writing surface (viewport-bounded, no scroll).
export const PAGE_CANVAS = "mx-[calc((100%-100vw)/2)] -my-3 min-h-0 flex-1 bg-slate-100";

// The page's scrollable content region below its header row: the app-wide
// gutter (px-5) and scroll rhythm live here ONCE — list pages (via DataList),
// the teacher forms, and the code detail pages all share it.
//
// The SCROLLER is the full-bleed canvas, so the page scrollbar sits at the
// window edge; the inner div re-centers the content. Its `min-h-full` keeps
// the column at least viewport-high, so height-filling children (the /files
// editors' `fill` chain) start viewport-high and grow with their content.
// `className` is a cn-merged delta on the inner column (e.g. a page that
// manages its own vertical gaps).
export function PageBody({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn(PAGE_CANVAS, "page-scroll overflow-y-auto")} {...props}>
      <div
        className={cn(
          "mx-auto flex min-h-full w-full max-w-7xl flex-col gap-4 px-5 pt-4 pb-6",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
