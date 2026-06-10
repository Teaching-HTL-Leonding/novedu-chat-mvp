// Conversions between <input type="datetime-local"> values ("YYYY-MM-DDTHH:mm",
// local wall-clock time, no timezone) and unix timestamps in seconds (UTC).
//
// These MUST run in the browser: the user's timezone is only known there. The
// Date constructor interprets a date-time string WITHOUT a timezone suffix as
// local time (ES2015+), which is exactly the datetime-local semantics.

export function datetimeLocalToUnixSeconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function dateToDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function unixSecondsToDatetimeLocal(seconds: number): string {
  return dateToDatetimeLocal(new Date(seconds * 1000));
}

/** The current local time, at datetime-local (minute) precision. */
export function nowAsDatetimeLocal(): string {
  return dateToDatetimeLocal(new Date());
}

export type DatetimeLocalUnit = "hours" | "days" | "weeks";

/**
 * Adds wall-clock time to a datetime-local value. Uses calendar arithmetic
 * (setHours/setDate), so "+1 day" keeps the same time of day even across a DST
 * transition — which is what a teacher means by "one day later".
 */
export function addToDatetimeLocal(value: string, amount: number, unit: DatetimeLocalUnit): string {
  const date = new Date(value);
  if (unit === "hours") {
    date.setHours(date.getHours() + amount);
  } else if (unit === "days") {
    date.setDate(date.getDate() + amount);
  } else {
    date.setDate(date.getDate() + amount * 7);
  }
  return dateToDatetimeLocal(date);
}
