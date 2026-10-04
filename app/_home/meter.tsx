import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/lib/utils";

// A progress track with its fill: the XP bar and the Almost-there bars. The fill
// is the full-width bar scaled on x (a transform, never a width), fed by the
// `--fill` variable (docs/styling.md → runtime values via CSS variables).
export function Meter({
  value,
  fillClassName,
  className,
  style,
  ...props
}: { value: number; fillClassName: string } & ComponentProps<"div">) {
  const fill = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cn("relative overflow-hidden rounded-full bg-heat-0", className)}
      style={{ ...style, "--fill": fill } as CSSProperties}
      {...props}
    >
      <div
        className={cn("absolute inset-0 origin-left scale-x-(--fill) rounded-full", fillClassName)}
      />
    </div>
  );
}
