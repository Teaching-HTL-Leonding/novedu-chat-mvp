"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEGMENTED_NAV, segmentedItemVariants } from "@/components/ui/segmented-nav";
import { datetimeLocalToUnixSeconds, unixSecondsToDatetimeLocal } from "@/lib/datetime-local";
import {
  DIAGNOSTICS_PRESETS,
  type DiagnosticsPreset,
  MAX_RANGE_MS,
  PRESET_LABELS,
} from "@/lib/diagnostics-range";
import { cn } from "@/lib/utils";

// The diagnostics time filter (docs/diagnostics.md). Presets are plain links, like
// the usage dashboard's RangeTabs: they keep `tz`, set `range` and drop a custom
// `from`/`to`, and the server re-renders with fresh data. The custom form converts
// the two local `datetime-local` values to ISO UTC in the browser (the only place
// that knows the zone) and navigates to `?from=&to=`.

export type ActiveRange = DiagnosticsPreset | "custom" | null;

/** A local datetime-local value as ISO UTC, or undefined when empty/invalid. */
function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const seconds = datetimeLocalToUnixSeconds(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
}

export function RangeControls({
  active,
  from,
  to,
}: {
  active: ActiveRange;
  /** The resolved window (ISO UTC), to prefill the custom form. */
  from?: string;
  to?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fromId = useId();
  const toId = useId();

  // Prefill in the browser only: the server does not know the viewer's zone.
  useEffect(() => {
    if (from) setCustomFrom(unixSecondsToDatetimeLocal(Date.parse(from) / 1000));
    if (to) setCustomTo(unixSecondsToDatetimeLocal(Date.parse(to) / 1000));
  }, [from, to]);

  function presetHref(preset: DiagnosticsPreset): string {
    const params = new URLSearchParams(searchParams);
    params.delete("from");
    params.delete("to");
    params.set("range", preset);
    return `${pathname}?${params.toString()}`;
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fromIso = toIso(customFrom);
    const toIsoValue = toIso(customTo);
    if (!fromIso || !toIsoValue) {
      setError("Enter a start and an end.");
      return;
    }
    const span = Date.parse(toIsoValue) - Date.parse(fromIso);
    if (span <= 0) {
      setError("The start must be before the end.");
      return;
    }
    if (span > MAX_RANGE_MS) {
      setError("A range may span at most 31 days.");
      return;
    }
    setError(null);
    const params = new URLSearchParams(searchParams);
    params.delete("range");
    params.set("from", fromIso);
    params.set("to", toIsoValue);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="diagnostics-range-controls">
      <nav aria-label="Time range" className={SEGMENTED_NAV}>
        {DIAGNOSTICS_PRESETS.map((preset) => {
          const isActive = preset === active;
          return (
            <Link
              key={preset}
              href={presetHref(preset)}
              aria-current={isActive ? "page" : undefined}
              className={segmentedItemVariants({ active: isActive })}
            >
              {PRESET_LABELS[preset]}
            </Link>
          );
        })}
        <span
          aria-current={active === "custom" ? "page" : undefined}
          // Not a link — it only marks a custom window; inactive it stays muted.
          className={cn(
            segmentedItemVariants({ active: active === "custom" }),
            active !== "custom" && "text-foreground/50 hover:bg-transparent",
          )}
        >
          Custom
        </span>
      </nav>

      <form
        onSubmit={apply}
        className="flex flex-wrap items-center gap-2"
        aria-label="Custom range"
        noValidate
      >
        <label htmlFor={fromId} className="text-sm">
          From
        </label>
        <Input
          id={fromId}
          type="datetime-local"
          value={customFrom}
          onChange={(e) => setCustomFrom(e.target.value)}
        />
        <label htmlFor={toId} className="text-sm">
          To
        </label>
        <Input
          id={toId}
          type="datetime-local"
          value={customTo}
          onChange={(e) => setCustomTo(e.target.value)}
        />
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        {error ? (
          <p className="w-full text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
