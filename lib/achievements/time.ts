// Vienna-local calendar cuts for the start page (docs/home.md). Usage buckets are
// UTC hours (lib/usage-store.ts); every day, week and hour the page shows is
// derived from them here. Pure — no database, no clock of its own.

/** The one time zone every day/week/hour cut uses (a per-school setting once tenants exist). */
export const HOME_TIME_ZONE = "Europe/Vienna";

/** A Vienna-local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;

const DAY_MS = 86_400_000;

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOME_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: HOME_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** The Vienna-local date of an instant (a usage bucket's start, or "now"). */
export function localDateOf(instant: Date): LocalDate {
  const parts = dateParts.formatToParts(instant);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/** The Vienna-local hour (0–23) of an instant. */
export function localHourOf(instant: Date): number {
  return Number(part(hourParts.formatToParts(instant), "hour"));
}

/** Today's Vienna-local date. */
export function todayLocal(now: Date): LocalDate {
  return localDateOf(now);
}

// Calendar arithmetic runs on UTC midnights of the local date's numbers, so a
// DST change can never shift a day.
function toUtc(date: LocalDate): number {
  return Date.UTC(Number(date.slice(0, 4)), monthOf(date), dayOfMonth(date));
}

function fromUtc(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `date` shifted by `n` calendar days. */
export function addDays(date: LocalDate, n: number): LocalDate {
  return fromUtc(toUtc(date) + n * DAY_MS);
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function dayDistance(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: LocalDate): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

/** The ISO week a date belongs to, keyed by the date of its Monday. */
export function isoWeekKey(date: LocalDate): LocalDate {
  return addDays(date, -weekdayOf(date));
}

/** The month (0–11) of a local date. */
export function monthOf(date: LocalDate): number {
  return Number(date.slice(5, 7)) - 1;
}

/** The day of the month (1–31) of a local date. */
export function dayOfMonth(date: LocalDate): number {
  return Number(date.slice(8, 10));
}
