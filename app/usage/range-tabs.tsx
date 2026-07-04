"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { parseRange, USAGE_RANGE_LABELS, USAGE_RANGES } from "@/lib/usage-range";
import { cn } from "@/lib/utils";

// The dashboard time filter. It is really navigation — each range is a `<Link>`
// that sets `?range=`, the server page re-renders and its Suspense sections
// re-suspend (keyed by range), so switching shows the loading skeletons and streams
// fresh data with no client fetch. So it is a `<nav>` with `aria-current` on the
// active link, NOT an ARIA tablist (which would promise a tabpanel + arrow-key
// traversal these links don't have).

const TAB = "rounded-md px-3 py-1.5 font-medium text-sm transition-colors";

export function RangeTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = parseRange(searchParams.get("range"));
  return (
    <nav
      aria-label="Time range"
      className="inline-flex flex-wrap gap-1 self-start rounded-lg border border-foreground/15 p-1"
    >
      {USAGE_RANGES.map((range) => {
        const isActive = range === active;
        // Preserve any other params (e.g. a future `?code=` on a single-code stats
        // page that reuses this control); only `range` is overwritten.
        const params = new URLSearchParams(searchParams);
        params.set("range", range);
        return (
          <Link
            key={range}
            href={`${pathname}?${params.toString()}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              TAB,
              isActive
                ? "bg-foreground text-background"
                : "text-foreground/70 hover:bg-foreground/5",
            )}
          >
            {USAGE_RANGE_LABELS[range]}
          </Link>
        );
      })}
    </nav>
  );
}
