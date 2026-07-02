import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The stacked form-field recipe shared by the teacher forms (files, codes,
// images): a column of label + control (+ optional hint). Tiny styled elements,
// not a form framework — pages still own their structure and wiring; callers
// pass htmlFor/id as usual.
export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

// `htmlFor` is REQUIRED (not merely forwarded): every label must name its
// control, so the association is part of this component's contract rather
// than a suppressed per-call-site lint check.
export function FieldLabel({
  className,
  htmlFor,
  ...props
}: ComponentProps<"label"> & { htmlFor: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the association is enforced by the REQUIRED htmlFor prop above; the label text arrives via {...props} children, which the rule cannot see statically.
    <label
      htmlFor={htmlFor}
      className={cn("font-semibold text-foreground/70 text-xs", className)}
      {...props}
    />
  );
}

export function FieldHint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-foreground/70 text-sm", className)} {...props} />;
}

// THE inline form-status recipes (docs/styling.md ≥2-uses rule): every inline
// error/success message next to a form control or action row renders through
// these, so the look — and the announcement roles — can't drift per page.
export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("text-destructive text-sm", className)} {...props} />;
}

export function FieldSuccess({ className, ...props }: ComponentProps<"p">) {
  return <p role="status" className={cn("text-sm text-success", className)} {...props} />;
}
