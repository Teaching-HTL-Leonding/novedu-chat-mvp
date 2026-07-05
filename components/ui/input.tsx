import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The bordered-field recipe, shared by text-like <input> elements and <select>.
// Checkboxes/radios stay native (they follow the forced light color-scheme).
export const inputVariants = cva(
  "h-9 rounded-full border border-foreground/25 bg-background px-3 text-foreground text-sm placeholder:text-foreground/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputVariants(), className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(inputVariants(), className)} {...props} />;
}
