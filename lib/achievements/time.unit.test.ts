// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addDays,
  dayDistance,
  isoWeekKey,
  isSchoolHour,
  localDateOf,
  localHourOf,
  startOfLocalDay,
  todayLocal,
  weekdayOf,
} from "./time";

describe("Vienna-local cuts of UTC hour buckets", () => {
  it("maps both occurrences of local 02:00 on the autumn change to the same day", () => {
    // 2026-10-25: 00:00Z = 02:00 CEST, 01:00Z = 02:00 CET (clocks went back).
    const first = new Date("2026-10-25T00:00:00Z");
    const second = new Date("2026-10-25T01:00:00Z");
    expect(localDateOf(first)).toBe("2026-10-25");
    expect(localDateOf(second)).toBe("2026-10-25");
    expect(localHourOf(first)).toBe(2);
    expect(localHourOf(second)).toBe(2);
  });

  it("skips the missing spring hour: 01:00Z is local 03:00", () => {
    // 2026-03-29: 00:00Z = 01:00 CET, 01:00Z = 03:00 CEST (02:00 never exists).
    expect(localHourOf(new Date("2026-03-29T00:00:00Z"))).toBe(1);
    expect(localHourOf(new Date("2026-03-29T01:00:00Z"))).toBe(3);
  });

  it("puts a bucket before local midnight on the previous day", () => {
    // 22:00Z in summer is 00:00 the next local day; 21:00Z is still the same day.
    expect(localDateOf(new Date("2026-07-01T21:00:00Z"))).toBe("2026-07-01");
    expect(localDateOf(new Date("2026-07-01T22:00:00Z"))).toBe("2026-07-02");
    // Winter: UTC+1.
    expect(localDateOf(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");
  });

  it("todayLocal is the Vienna date of now", () => {
    expect(todayLocal(new Date("2026-10-04T22:30:00Z"))).toBe("2026-10-05");
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("measures day distance in calendar dates, not elapsed hours", () => {
    expect(dayDistance("2026-10-24", "2026-10-26")).toBe(2); // 49 h apart
    expect(dayDistance("2026-03-28", "2026-03-30")).toBe(2); // 47 h apart
    expect(dayDistance("2026-10-26", "2026-10-24")).toBe(-2);
  });

  it("keys a week by its Monday, also across New Year", () => {
    expect(weekdayOf("2026-10-05")).toBe(0); // Monday
    expect(weekdayOf("2026-10-04")).toBe(6); // Sunday
    expect(isoWeekKey("2026-10-04")).toBe("2026-09-28");
    // Mon 28 Dec 2026 – Sun 3 Jan 2027 is one week.
    expect(isoWeekKey("2026-12-31")).toBe("2026-12-28");
    expect(isoWeekKey("2027-01-03")).toBe("2026-12-28");
    expect(isoWeekKey("2027-01-04")).toBe("2027-01-04");
  });
});

describe("local midnight", () => {
  it("is 22:00Z in summer and 23:00Z in winter", () => {
    expect(startOfLocalDay("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfLocalDay("2026-12-01").toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });

  it("holds on both clock-change days", () => {
    // The changes happen at 02:00/03:00, so midnight keeps the previous offset.
    expect(startOfLocalDay("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfLocalDay("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(startOfLocalDay("2026-10-26").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("school hours", () => {
  // Mon 5 Oct 2026, CEST (UTC+2): local h = UTC h + 2.
  const monday = (utcHour: number) =>
    new Date(`2026-10-05T${String(utcHour).padStart(2, "0")}:00:00Z`);

  it("are Monday to Friday from 08:00 up to, not including, 17:00", () => {
    expect(isSchoolHour(monday(5))).toBe(false); // 07:00
    expect(isSchoolHour(monday(6))).toBe(true); // 08:00
    expect(isSchoolHour(monday(14))).toBe(true); // 16:00
    expect(isSchoolHour(monday(15))).toBe(false); // 17:00
    expect(isSchoolHour(new Date("2026-10-09T10:00:00Z"))).toBe(true); // Fri 12:00
  });

  it("never include a weekend hour", () => {
    expect(isSchoolHour(new Date("2026-10-03T10:00:00Z"))).toBe(false); // Sat 12:00
    expect(isSchoolHour(new Date("2026-10-04T10:00:00Z"))).toBe(false); // Sun 12:00
  });

  it("use the local hour and day, not UTC", () => {
    // Winter (UTC+1): 07:00Z is local 08:00 on Mon 7 Dec.
    expect(isSchoolHour(new Date("2026-12-07T07:00:00Z"))).toBe(true);
    // Sunday 23:00Z is local Monday 00:00 — a weekday, but not a school hour.
    expect(isSchoolHour(new Date("2026-12-06T23:00:00Z"))).toBe(false);
    // Friday 16:00Z in winter is local 17:00: outside.
    expect(isSchoolHour(new Date("2026-12-11T16:00:00Z"))).toBe(false);
  });
});
