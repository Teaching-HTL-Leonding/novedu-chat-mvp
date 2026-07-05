import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Square icon action button shared across list rows and toolbars. The accessible
// label lives on the element (aria-label); the icon is decorative. Anchor
// variants (<Link>/<a>) consume `iconButtonVariants` directly.
export const iconButtonVariants = cva(
  "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground/25 bg-transparent text-inherit no-underline transition-colors not-disabled:hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4",
);

export function IconButton({ className, type = "button", ...props }: ComponentProps<"button">) {
  return <button type={type} className={cn(iconButtonVariants(), className)} {...props} />;
}
