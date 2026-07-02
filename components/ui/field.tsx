import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The stacked form-field recipe shared by the teacher forms (files, codes,
// images): a column of label + control (+ optional hint). Tiny styled elements,
// not a form framework — pages still own their structure and wiring; callers
// pass htmlFor/id as usual.
export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor arrives via props at each call site
  return <label className={cn("font-semibold text-foreground/70 text-xs", className)} {...props} />;
}

export function FieldHint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-foreground/70 text-sm", className)} {...props} />;
}
