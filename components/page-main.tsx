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
