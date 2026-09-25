// Pure time-range helpers for the LLM diagnostics page (docs/diagnostics.md). No
// I/O and no `new Date()` inside — `now` is always injected, so every function is
// deterministic and unit-testable. Safe to import from client or server.
//
// Unlike the usage dashboard (UTC only), this page thinks in the VIEWER's local
// time: a preset ("Today") is resolved against the browser's IANA zone, which the
// URL carries as `tz`. Node ships full ICU, so the server resolves any zone,
// including a DST switch inside the range. A custom range arrives as two ISO UTC
// instants the browser already converted (lib/datetime-local.ts), so it needs no
// zone at all.

export type DiagnosticsPreset = "today" | "yesterday" | "last7d";

export const DIAGNOSTICS_PRESETS: readonly DiagnosticsPreset[] = [
  "today",
  "yesterday",
  "last7d",
] as const;

export const PRESET_LABELS: Record<DiagnosticsPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7d: "Last 7 days",
};

/** Chart bin sizes, spelled as KQL timespan literals. */
export type BinSize = "1m" | "5m" | "1h" | "6h";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const BIN_MS: Record<BinSize, number> = {
  "1m": MINUTE_MS,
  "5m": 5 * MINUTE_MS,
  "1h": HOUR_MS,
  "6h": 6 * HOUR_MS,
};

/** The longest range the page queries (App Insights cost + chart density). */
export const MAX_RANGE_MS = 31 * DAY_MS;

/** A defensive cap on the bin list; the bin choice keeps real ranges far below it. */
const MAX_BINS = 2000;

export type RangeSource =
  | { kind: "preset"; preset: DiagnosticsPreset; tz: string }
  | { kind: "custom" };

export interface ResolvedRange {
  /** Inclusive start (UTC instant). */
  from: Date;
  /** Exclusive end, never after `now`. */
  to: Date;
  bin: BinSize;
  /** Every bin start (ISO), oldest first — the zero-fill skeleton of each chart. */
  binKeys: string[];
  /** A stable identity of this window, used to key the Suspense boundaries. */
  key: string;
  source: RangeSource;
}

/** The subset of the page's search params this module reads. */
export type RangeParams = Readonly<
  Partial<Record<"range" | "tz" | "from" | "to", string | string[] | undefined>>
>;

export type RangeParse =
  /** No `tz` yet: the browser must add its zone before anything is queried. */
  { kind: "needs-tz" } | { kind: "resolved"; range: ResolvedRange; notice?: string };

export function isDiagnosticsPreset(value: unknown): value is DiagnosticsPreset {
  return typeof value === "string" && (DIAGNOSTICS_PRESETS as readonly string[]).includes(value);
}

/** True for a zone name the runtime's ICU knows (e.g. `Europe/Vienna`, `UTC`). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// --- Zone arithmetic ---------------------------------------------------------

export interface YearMonthDay {
  year: number;
  month: number; // 1-12
  day: number;
}

function zonedParts(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The zone's offset from UTC at an instant, in ms (Vienna in summer: +7_200_000). */
function zoneOffsetMs(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop the sub-second part of `at`, which the wall-clock parts cannot carry.
  return wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The local calendar date of an instant in a zone. */
export function zonedDate(at: Date, tz: string): YearMonthDay {
  const { year, month, day } = zonedParts(at, tz);
  return { year, month, day };
}

/**
 * The UTC instant of local midnight on `ymd` in `tz`. Two passes: guess with the
 * offset at "midnight read as UTC", then re-read the offset at the first result —
 * the second pass corrects a guess that landed on the other side of a DST switch.
 */
export function zonedMidnightUtc(ymd: YearMonthDay, tz: string): Date {
  const naive = Date.UTC(ymd.year, ymd.month - 1, ymd.day);
  const first = naive - zoneOffsetMs(new Date(naive), tz);
  const second = naive - zoneOffsetMs(new Date(first), tz);
  return new Date(second);
}

function addCalendarDays(ymd: YearMonthDay, days: number): YearMonthDay {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// --- Resolution --------------------------------------------------------------

/** A window plus the bin it is charted in. */
export interface BinnedWindow {
  from: Date;
  to: Date;
  bin: BinSize;
}

/**
 * Floors `at` down to a multiple of `bin` counted from midnight — local midnight
 * in `tz`, or UTC midnight without a zone — so the bins of a rolling window fall
 * on the local clock's boundaries (hours in Asia/Kolkata start at :30 UTC). Never
 * later than `at`.
 */
export function floorToBin(at: Date, bin: BinSize, tz?: string): Date {
  const anchor = tz
    ? zonedMidnightUtc(zonedDate(at, tz), tz).getTime()
    : Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const step = BIN_MS[bin];
  return new Date(anchor + Math.floor((at.getTime() - anchor) / step) * step);
}

/**
 * A window of `spanMs` ending `now` whose start is floored to its bin. The bin is
 * chosen from the NOMINAL span and carried along: the floored window is up to one
 * bin longer, which could cross a `chooseBin` threshold (7 d + 40 min → 6 h).
 */
function rollingWindow(spanMs: number, now: Date, tz?: string): BinnedWindow {
  const nominalFrom = new Date(now.getTime() - spanMs);
  const bin = chooseBin(nominalFrom, now);
  return { from: floorToBin(nominalFrom, bin, tz), to: now, bin };
}

/**
 * A preset's window in a zone, with its bin. `today` is local midnight → now;
 * `yesterday` is the whole previous local day (23 h or 25 h on a DST day); both
 * start at local midnight, which is already a bin boundary. `last7d` is a rolling
 * 7 × 24 h ending now whose start is floored to its 1 h bin (counted from local
 * midnight), so it is up to one bin longer.
 */
export function resolvePreset(preset: DiagnosticsPreset, tz: string, now: Date): BinnedWindow {
  if (preset === "last7d") return rollingWindow(7 * DAY_MS, now, tz);
  const today = zonedDate(now, tz);
  const todayStart = zonedMidnightUtc(today, tz);
  if (preset === "today") return { from: todayStart, to: now, bin: chooseBin(todayStart, now) };
  const yesterdayStart = zonedMidnightUtc(addCalendarDays(today, -1), tz);
  return { from: yesterdayStart, to: todayStart, bin: chooseBin(yesterdayStart, todayStart) };
}

export type CustomRangeCheck =
  | { ok: true; from: Date; to: Date }
  | { ok: false; reason: "unparsable" | "from-not-before-to" | "too-long" };

/**
 * Validates a custom range given as two ISO instants. `to` is clamped to `now`
 * silently (a window reaching into the future just ends now); the remaining window
 * must be non-empty and at most 31 days long.
 */
export function validateCustomRange(from: unknown, to: unknown, now: Date): CustomRangeCheck {
  const f = typeof from === "string" && from.trim() !== "" ? new Date(from) : undefined;
  const t = typeof to === "string" && to.trim() !== "" ? new Date(to) : undefined;
  if (!f || !t || Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
    return { ok: false, reason: "unparsable" };
  }
  const clampedTo = t.getTime() > now.getTime() ? now : t;
  if (f.getTime() >= clampedTo.getTime()) return { ok: false, reason: "from-not-before-to" };
  if (clampedTo.getTime() - f.getTime() > MAX_RANGE_MS) return { ok: false, reason: "too-long" };
  return { ok: true, from: f, to: clampedTo };
}

/** Bin size by span: ≤ 3 h → 1 min, ≤ 24 h → 5 min, ≤ 7 d → 1 h, else 6 h. */
export function chooseBin(from: Date, to: Date): BinSize {
  const span = to.getTime() - from.getTime();
  if (span <= 3 * HOUR_MS) return "1m";
  if (span <= DAY_MS) return "5m";
  if (span <= 7 * DAY_MS) return "1h";
  return "6h";
}

/**
 * Every bin start from `from` in `bin` steps while before `to`. Aligned to `from`
 * itself, not to a clock boundary — the KQL bins with
 * `bin_at(timestamp, <bin>, datetime(<from>))` over the same `from`, so the two
 * lists meet key for key. (A rolling window's `from` is already floored to a bin
 * boundary by `resolvePreset` / `parseDiagnosticsParams`.)
 */
export function binStarts(from: Date, to: Date, bin: BinSize): Date[] {
  const step = BIN_MS[bin];
  const out: Date[] = [];
  for (let t = from.getTime(); t < to.getTime() && out.length < MAX_BINS; t += step) {
    out.push(new Date(t));
  }
  return out;
}

/** `bin` defaults to the span's; a floored rolling window passes the one it carries. */
function buildRange(
  from: Date,
  to: Date,
  source: RangeSource,
  bin: BinSize = chooseBin(from, to),
): ResolvedRange {
  return {
    from,
    to,
    bin,
    binKeys: binStarts(from, to, bin).map((d) => d.toISOString()),
    key: `${from.toISOString()}_${to.toISOString()}`,
    source,
  };
}

/** A search param as one string: `undefined` when absent, `null` when repeated. */
function single(value: string | string[] | undefined): string | undefined | null {
  if (Array.isArray(value)) return null;
  return value;
}

const CUSTOM_NOTICES: Record<"unparsable" | "from-not-before-to" | "too-long", string> = {
  unparsable: "The custom range could not be read.",
  "from-not-before-to": "The custom range must start before it ends.",
  "too-long": "The custom range may span at most 31 days.",
};

/**
 * The page's search params → a resolved window, or `needs-tz` when the browser has
 * not yet added its zone. `from`/`to` (custom) take precedence over `range` and are
 * used as given. An invalid custom range falls back to the last 24 hours — a
 * rolling window whose start is floored to its 5 min bin in UTC — an invalid
 * preset or zone to Today (in UTC when the zone itself is unusable), each with a
 * notice. A
 * PRESENT but invalid `tz` never yields `needs-tz`, so the client redirect that
 * adds the zone cannot loop.
 */
export function parseDiagnosticsParams(params: RangeParams, now: Date): RangeParse {
  const from = single(params.from);
  const to = single(params.to);
  if (from !== undefined || to !== undefined) {
    const check = validateCustomRange(from, to, now);
    if (check.ok) {
      return { kind: "resolved", range: buildRange(check.from, check.to, { kind: "custom" }) };
    }
    const fallback = rollingWindow(DAY_MS, now);
    return {
      kind: "resolved",
      range: buildRange(fallback.from, fallback.to, { kind: "custom" }, fallback.bin),
      notice: `${CUSTOM_NOTICES[check.reason]} Showing the last 24 hours instead.`,
    };
  }

  const tz = single(params.tz);
  if (tz === undefined) return { kind: "needs-tz" };

  const notices: string[] = [];
  let zone = "UTC";
  if (isValidTimeZone(tz)) {
    zone = tz;
  } else {
    notices.push("Your time zone is unknown here, so times are resolved in UTC.");
  }

  const rangeParam = single(params.range);
  let preset: DiagnosticsPreset = "today";
  if (isDiagnosticsPreset(rangeParam)) {
    preset = rangeParam;
  } else if (rangeParam !== undefined) {
    notices.push("Unknown time range; showing Today instead.");
  }

  const window = resolvePreset(preset, zone, now);
  return {
    kind: "resolved",
    range: buildRange(window.from, window.to, { kind: "preset", preset, tz: zone }, window.bin),
    ...(notices.length > 0 ? { notice: notices.join(" ") } : {}),
  };
}
