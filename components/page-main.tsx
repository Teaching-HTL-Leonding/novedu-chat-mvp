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

// The page's scrollable content region below its header row: the app-wide
// gutter (px-5) and scroll rhythm live here ONCE — list pages (via DataList),
// the teacher forms, and the code detail pages all share it. `className` is a
// cn-merged delta (e.g. a page that manages its own vertical gaps).
export function PageBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-6", className)}
      {...props}
    />
  );
}
