import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The app-wide button recipe. `size` is declared before `variant` so a variant
// can override sizing (link renders as inline text) through cn()'s merge.
// Links styled as buttons consume `buttonVariants` directly:
//   <Link className={cn(buttonVariants({ variant: "outline" }))} …>
export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold text-sm no-underline transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      size: {
        md: "h-9 px-4",
        sm: "h-8 px-3",
      },
      variant: {
        primary: "bg-primary text-primary-foreground not-disabled:hover:bg-primary/90",
        outline:
          "border border-foreground/25 bg-background text-foreground not-disabled:hover:bg-foreground/5",
        destructiveOutline:
          "border border-destructive/45 bg-transparent text-destructive not-disabled:hover:bg-destructive/10",
        link: "h-auto p-0 font-normal text-foreground/70 underline not-disabled:hover:text-foreground",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
