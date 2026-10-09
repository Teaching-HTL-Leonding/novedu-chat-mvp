import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Square icon action button shared across list rows and toolbars. The accessible
// label lives on the element (aria-label); the icon is decorative. Anchor
// variants (<Link>/<a>) consume `iconButtonVariants` directly.
//
// `[&_svg]:pointer-events-none` is what makes the `title` tooltip work: the icon
// fills the middle of the button, and Chrome shows no HTML `title` while the
// pointer is over inline SVG content (SVG takes tooltips from its own <title>).
// With the icon transparent to the pointer, hovering anywhere hits the button
// itself, so its tooltip appears; clicks still land on the button.
export const iconButtonVariants = cva(
  "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground/25 bg-transparent text-inherit no-underline transition-colors not-disabled:hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
);

export function IconButton({ className, type = "button", ...props }: ComponentProps<"button">) {
  return <button type={type} className={cn(iconButtonVariants(), className)} {...props} />;
}
