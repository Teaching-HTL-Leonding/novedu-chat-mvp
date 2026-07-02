import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Small status/kind chip used in list cells (code module, file kind, window
// status, health probes). Tones are a fixed palette; callers map their domain
// (file kind, window status, …) onto a tone. `caps` renders the label as
// small uppercase (kind/status chips); module names stay lowercase.
export const badgeVariants = cva(
  "inline-block whitespace-nowrap rounded-md px-1.5 py-px font-semibold text-xs",
  {
    variants: {
      tone: {
        neutral: "bg-foreground/10 text-foreground/80",
        red: "bg-red-600/15 text-red-800",
        blue: "bg-blue-600/15 text-blue-800",
        green: "bg-emerald-600/15 text-emerald-800",
        orange: "bg-orange-500/20 text-orange-800",
        purple: "bg-purple-500/20 text-purple-800",
      },
      caps: {
        true: "uppercase tracking-wide",
        false: "",
      },
    },
    defaultVariants: { tone: "neutral", caps: false },
  },
);

export function Badge({
  className,
  tone,
  caps,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, caps }), className)} {...props} />;
}
