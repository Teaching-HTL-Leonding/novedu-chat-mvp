import type { ComponentProps, ReactNode } from "react";
import { META_LABEL } from "@/components/ui/meta-label";
import { cn } from "@/lib/utils";

// A labelled big-number tile — a `<dt>`/`<dd>` pair — for a stats/KPI summary row;
// render inside a `<dl>`. The number stays in the app ink; the label uses the
// shared small-caps META_LABEL. Shared by the per-code conversation stats and the
// usage dashboard KPIs (docs/dashboard.md). `className` is a cn-merged delta on the
// tile box.
export function StatTile({
  label,
  value,
  className,
  ...props
}: { label: ReactNode; value: ReactNode } & Omit<ComponentProps<"div">, "children">) {
  return (
    <div
      className={cn("min-w-32 rounded-lg border border-foreground/15 bg-card px-4 py-3", className)}
      {...props}
    >
      <dt className={cn("mb-1", META_LABEL)}>{label}</dt>
      <dd className="font-bold text-2xl leading-none">{value}</dd>
    </div>
  );
}
