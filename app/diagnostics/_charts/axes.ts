// Axis labels of the diagnostics charts. The x-axis is the bin start (epoch ms),
// labelled in local time: these run in the browser, so `Intl` formats in the
// VIEWER's zone — the page's time model (docs/diagnostics.md). Fixed en-US 24-hour
// output so the axis reads the same for every viewer locale. Client-safe, no state.

const DAY_MS = 86_400_000;

const clock = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayClock = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Tick labels: `HH:mm` for ranges up to a day, `MMM d, HH:mm` beyond. */
export function tickFormatter(spanMs: number): (t: number) => string {
  const fmt = spanMs <= DAY_MS ? clock : dayClock;
  return (t) => fmt.format(new Date(t));
}

/** Tooltip heading: always with the date. */
export function tooltipLabel(t: unknown): string {
  const n = Number(t);
  return Number.isFinite(n) ? dayClock.format(new Date(n)) : "";
}

/** Duration axis ticks (the values are milliseconds): `12 s`. */
export const secondsTick = (ms: number): string => `${Math.round(ms / 1000)} s`;
