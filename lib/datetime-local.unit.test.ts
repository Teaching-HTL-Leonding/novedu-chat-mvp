import { afterEach, expect, test, vi } from "vitest";
import {
  addToDatetimeLocal,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
  unixSecondsToDatetimeLocal,
} from "./datetime-local";

afterEach(() => {
  vi.useRealTimers();
});

// These conversions are timezone-dependent by design (datetime-local values are
// local wall-clock time), so the tests assert relationships rather than fixed
// timestamps — they must pass in any timezone the test runner happens to use.

test("agrees with the Date constructor's local-time parsing", () => {
  const value = "2026-06-10T14:30";
  expect(datetimeLocalToUnixSeconds(value)).toBe(Math.floor(new Date(value).getTime() / 1000));
});

test("one hour of wall-clock time is 3600 seconds", () => {
  // A normal (non-DST-transition) hour.
  expect(
    datetimeLocalToUnixSeconds("2026-01-15T11:00") - datetimeLocalToUnixSeconds("2026-01-15T10:00"),
  ).toBe(3600);
});

test("round-trips through unixSecondsToDatetimeLocal", () => {
  for (const value of ["2026-06-10T14:30", "2026-01-01T00:00", "2030-12-31T23:59"]) {
    expect(unixSecondsToDatetimeLocal(datetimeLocalToUnixSeconds(value))).toBe(value);
  }
});

test("formats with zero-padded components", () => {
  const seconds = datetimeLocalToUnixSeconds("2026-03-05T07:08");
  expect(unixSecondsToDatetimeLocal(seconds)).toBe("2026-03-05T07:08");
});

test("nowAsDatetimeLocal reflects the current local time at minute precision", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 10, 14, 30, 45)); // local time, seconds dropped
  expect(nowAsDatetimeLocal()).toBe("2026-06-10T14:30");
});

test("addToDatetimeLocal adds hours, days, and weeks in wall-clock terms", () => {
  expect(addToDatetimeLocal("2026-06-10T14:30", 1, "hours")).toBe("2026-06-10T15:30");
  expect(addToDatetimeLocal("2026-06-10T14:30", 1, "days")).toBe("2026-06-11T14:30");
  expect(addToDatetimeLocal("2026-06-10T14:30", 1, "weeks")).toBe("2026-06-17T14:30");
});

test("addToDatetimeLocal rolls over hour, day, month, and year boundaries", () => {
  expect(addToDatetimeLocal("2026-06-10T23:30", 1, "hours")).toBe("2026-06-11T00:30");
  expect(addToDatetimeLocal("2026-06-30T14:30", 1, "days")).toBe("2026-07-01T14:30");
  expect(addToDatetimeLocal("2026-12-29T14:30", 1, "weeks")).toBe("2027-01-05T14:30");
});

test("addToDatetimeLocal keeps the time of day when crossing a day (calendar arithmetic)", () => {
  // Calendar (not 86 400-second) arithmetic: the wall-clock time is preserved
  // even if a DST transition happens to fall inside the added span.
  const result = addToDatetimeLocal("2026-03-28T09:00", 1, "days");
  expect(result.endsWith("T09:00")).toBe(true);
});
