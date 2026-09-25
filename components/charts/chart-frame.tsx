"use client";

import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

// The box every chart renders into: full width, a fixed height (`h-72` unless the
// caller passes another `h-*` delta), and `text-foreground`, which the chrome's
// `currentColor` strokes and ticks inherit (chart-chrome.tsx). Recharts'
// ResponsiveContainer needs this measured parent.
export function ChartFrame({
  className,
  children,
}: {
  className?: string;
  children: ReactElement;
}) {
  return (
    <div className={cn("h-72 w-full text-foreground", className)}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
