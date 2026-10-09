import { describe, expect, it } from "vitest";
import {
  availableTeacherGroups,
  busyReached,
  type CodeDay,
  type CodeUsage,
  closingSoon,
  codeUsage,
  crowdReached,
  homeworkReached,
  kindsReached,
  LIST_MAX,
  neverUsed,
  outsideSchoolPercent,
  reportedCodes,
  type TeacherCode,
  topActivities,
  usageTotals,
  weeksReached,
  windowOpen,
  windowStart,
} from "./teacher";

const NOW = new Date("2026-10-04T17:30:00Z"); // Sun 4 Oct, 19:30 Vienna (CEST)
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const code = (id: string, extra: Partial<TeacherCode> = {}): TeacherCode => ({
  code: id,
  module: "tutor",
  note: "",
  validFrom: null,
  validUntil: null,
  createdAt: at(-30 * DAY),
  ...extra,
});

const usage = (id: string, extra: Partial<CodeUsage> = {}): CodeUsage => ({
  code: id,
  interactions: 0,
  outsideSchool: 0,
  quizAnswers: 0,
  inputTokens: 0,
  outputTokens: 0,
  ...extra,
});

describe("the 30-day window", () => {
  it("starts at local midnight 29 days before today, so today is the 30th day", () => {
    expect(windowStart(NOW).toISOString()).toBe("2026-09-04T22:00:00.000Z"); // 5 Sep 00:00 CEST
  });

  it("starts at the winter offset once the window lies after the autumn change", () => {
    // Today 24 Nov (CET): the window starts 26 Oct 00:00 CET = 25 Oct 23:00Z.
    expect(windowStart(new Date("2026-11-24T12:00:00Z")).toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });
});

describe("windowOpen (the checkCode rule)", () => {
  it("is open without bounds, between them, and on the bounds themselves", () => {
    expect(windowOpen(code("a"), NOW)).toBe(true);
    expect(windowOpen(code("a", { validFrom: NOW, validUntil: NOW }), NOW)).toBe(true);
  });

  it("is closed before the start and after the end", () => {
    expect(windowOpen(code("a", { validFrom: at(HOUR) }), NOW)).toBe(false);
    expect(windowOpen(code("a", { validUntil: at(-HOUR) }), NOW)).toBe(false);
  });
});

describe("closingSoon", () => {
  it("keeps open codes ending within 3 days, soonest first", () => {
    const codes = [
      code("later", { validUntil: at(2 * DAY) }),
      code("soon", { validUntil: at(HOUR) }),
      code("edge", { validUntil: at(3 * DAY) }),
      code("past-edge", { validUntil: at(3 * DAY + 1) }),
      code("no-end"),
      code("ended", { validUntil: at(-HOUR) }),
      code("not-started", { validFrom: at(HOUR), validUntil: at(DAY) }),
    ];
    expect(closingSoon(codes, NOW).map((c) => c.code)).toEqual(["soon", "later", "edge"]);
  });

  it("orders ties by code", () => {
    const end = at(DAY);
    const codes = [code("b", { validUntil: end }), code("a", { validUntil: end })];
    expect(closingSoon(codes, NOW).map((c) => c.code)).toEqual(["a", "b"]);
  });
});

describe("neverUsed", () => {
  it("keeps open codes older than a week without any usage row, oldest first", () => {
    const codes = [
      code("old-unused", { createdAt: at(-20 * DAY) }),
      code("older-unused", { createdAt: at(-40 * DAY) }),
      code("used", { createdAt: at(-20 * DAY) }),
      code("young", { createdAt: at(-6 * DAY) }),
      code("ended", { createdAt: at(-20 * DAY), validUntil: at(-HOUR) }),
      code("not-started", { createdAt: at(-20 * DAY), validFrom: at(DAY) }),
    ];
    // A code with a usage row counts as used even with nothing in the window.
    const rows = [usage("used")];
    expect(neverUsed(codes, rows, NOW).map((c) => c.code)).toEqual(["older-unused", "old-unused"]);
  });

  it("needs MORE than seven days", () => {
    const codes = [code("exactly", { createdAt: at(-7 * DAY) })];
    expect(neverUsed(codes, [], NOW)).toEqual([]);
  });
});

describe("reportedCodes", () => {
  it("most open reports first, ties by code, zeros dropped", () => {
    const rows = [
      { code: "b", open: 1 },
      { code: "a", open: 1 },
      { code: "c", open: 3 },
      { code: "d", open: 0 },
    ];
    expect(reportedCodes(rows).map((r) => r.code)).toEqual(["c", "a", "b"]);
  });
});

describe("topActivities", () => {
  it("ranks by interactions in the window, ties by code, at most five, never an idle code", () => {
    const rows = [
      usage("idle"),
      usage("f", { interactions: 1 }),
      usage("e", { interactions: 10 }),
      usage("d", { interactions: 10 }),
      usage("c", { interactions: 30 }),
      usage("b", { interactions: 40 }),
      usage("a", { interactions: 50 }),
    ];
    expect(topActivities(rows).map((u) => u.code)).toEqual(["a", "b", "c", "d", "e"]);
    expect(topActivities(rows)).toHaveLength(LIST_MAX);
  });
});

describe("outsideSchoolPercent", () => {
  it("rounds to a whole percent", () => {
    expect(outsideSchoolPercent(usage("a", { interactions: 3, outsideSchool: 1 }))).toBe(33);
    expect(outsideSchoolPercent(usage("a", { interactions: 3, outsideSchool: 2 }))).toBe(67);
    expect(outsideSchoolPercent(usage("a", { interactions: 4, outsideSchool: 4 }))).toBe(100);
  });

  it("is 0 for a code without interactions", () => {
    expect(outsideSchoolPercent(usage("a"))).toBe(0);
  });
});

describe("usageTotals", () => {
  it("sums the window's quiz answers and tokens over every code", () => {
    const rows = [
      usage("a", { quizAnswers: 3, inputTokens: 100, outputTokens: 10 }),
      usage("b", { quizAnswers: 4, inputTokens: 200, outputTokens: 20 }),
    ];
    expect(usageTotals(rows)).toEqual({ quizAnswers: 7, inputTokens: 300, outputTokens: 30 });
    expect(usageTotals([])).toEqual({ quizAnswers: 0, inputTokens: 0, outputTokens: 0 });
  });
});

const codeDay = (id: string, date: string, extra: Partial<CodeDay> = {}): CodeDay => ({
  code: id,
  date,
  interactions: 0,
  outsideSchool: 0,
  quizAnswers: 0,
  inputTokens: 0,
  outputTokens: 0,
  ...extra,
});

describe("codeUsage", () => {
  it("sums each code's days from the window's first local day (5 Sep) on", () => {
    const days = [
      codeDay("a", "2026-09-04", { interactions: 100, quizAnswers: 100 }),
      codeDay("a", "2026-09-05", { interactions: 3, outsideSchool: 1, inputTokens: 7 }),
      codeDay("a", "2026-10-04", { interactions: 2, quizAnswers: 2, outputTokens: 5 }),
    ];
    expect(codeUsage(days, NOW)).toEqual([
      usage("a", {
        interactions: 5,
        outsideSchool: 1,
        quizAnswers: 2,
        inputTokens: 7,
        outputTokens: 5,
      }),
    ]);
  });

  it("keeps a code used only before the window, with zeros — it was used", () => {
    expect(codeUsage([codeDay("old", "2026-01-10", { interactions: 9 })], NOW)).toEqual([
      usage("old"),
    ]);
  });
});

describe("availableTeacherGroups", () => {
  it("lists exactly the groups that loaded", () => {
    expect([...availableTeacherGroups({ codes: [], files: { most: 0 } })].sort()).toEqual([
      "codes",
      "files",
    ]);
  });
});

describe("kindsReached", () => {
  it("dates each kind by its first code, ascending, one entry per kind", () => {
    const codes = [
      code("q2", { module: "quiz", createdAt: new Date("2026-09-20T10:00:00Z") }),
      code("t", { module: "tutor", createdAt: new Date("2026-09-10T10:00:00Z") }),
      code("q1", { module: "quiz", createdAt: new Date("2026-09-12T10:00:00Z") }),
      // 23:30Z on 30 Sep is already 1 Oct in Vienna.
      code("w", { module: "writing", createdAt: new Date("2026-09-30T23:30:00Z") }),
    ];
    expect(kindsReached(codes)).toEqual(["2026-09-10", "2026-09-12", "2026-10-01"]);
  });
});

describe("crowdReached", () => {
  const perCode = [
    {
      code: "a",
      count: 12,
      firstSeen: [
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-09-04",
        "2026-09-05",
        "2026-09-06",
        "2026-09-07",
        "2026-09-08",
        "2026-09-09",
        "2026-09-20",
        "2026-09-21",
        "2026-09-22",
      ],
    },
    { code: "b", count: 10, firstSeen: Array.from({ length: 10 }, () => "2026-09-15") },
  ];

  it("is the earliest day any one activity had its n-th student", () => {
    expect(crowdReached({ total: 20, perCode }, 10)).toEqual({ reachedOn: "2026-09-15", best: 12 });
  });

  it("reports the best activity below the threshold — students never add up across activities", () => {
    expect(crowdReached({ total: 22, perCode }, 30)).toEqual({ best: 12 });
    expect(crowdReached({ total: 0, perCode: [] }, 10)).toEqual({ best: 0 });
  });
});

describe("busyReached", () => {
  it("is the earliest day one activity's running total reached n", () => {
    const days = [
      codeDay("a", "2026-09-03", { interactions: 60 }),
      codeDay("a", "2026-09-01", { interactions: 50 }),
      codeDay("b", "2026-09-02", { interactions: 99 }),
    ];
    // a: 50 on 1 Sep, 110 on 3 Sep (the days are sorted per code first).
    expect(busyReached(days, 100)).toEqual({ reachedOn: "2026-09-03", best: 100 });
    expect(busyReached(days, 1000)).toEqual({ best: 110 });
  });

  it("at the threshold exactly counts; activities never add up", () => {
    expect(busyReached([codeDay("a", "2026-09-01", { interactions: 100 })], 100).reachedOn).toBe(
      "2026-09-01",
    );
    expect(
      busyReached(
        [
          codeDay("a", "2026-09-01", { interactions: 60 }),
          codeDay("b", "2026-09-01", { interactions: 60 }),
        ],
        100,
      ),
    ).toEqual({ best: 60 });
  });
});

describe("weeksReached", () => {
  it("dates the n-th different ISO week of one activity, skipping idle days", () => {
    const days = [
      codeDay("a", "2026-08-31", { interactions: 1 }), // week of 31 Aug
      codeDay("a", "2026-09-06", { interactions: 1 }), // same week (Sunday)
      codeDay("a", "2026-09-07", { interactions: 0, inputTokens: 5 }), // tokens only
      codeDay("a", "2026-09-08", { interactions: 1 }), // week of 7 Sep
    ];
    expect(weeksReached(days, 2)).toEqual({ reachedOn: "2026-09-08", best: 2 });
    expect(weeksReached(days, 8)).toEqual({ best: 2 });
  });

  it("an ISO week crossing New Year is one week", () => {
    const days = [
      codeDay("a", "2026-12-31", { interactions: 1 }),
      codeDay("a", "2027-01-02", { interactions: 1 }),
    ];
    expect(weeksReached(days, 2)).toEqual({ best: 1 });
  });
});

describe("homeworkReached", () => {
  it("needs at least 50 interactions, at least half of them outside school hours", () => {
    const days = [
      codeDay("a", "2026-09-01", { interactions: 40, outsideSchool: 40 }),
      codeDay("a", "2026-09-02", { interactions: 10, outsideSchool: 0 }), // 50, 40 outside
    ];
    expect(homeworkReached(days)).toEqual({ reachedOn: "2026-09-02", best: 1 });
  });

  it("exactly half counts; below half or below 50 does not, and shows no count", () => {
    expect(
      homeworkReached([codeDay("a", "2026-09-01", { interactions: 50, outsideSchool: 25 })]),
    ).toEqual({ reachedOn: "2026-09-01", best: 1 });
    expect(
      homeworkReached([codeDay("a", "2026-09-01", { interactions: 50, outsideSchool: 24 })]),
    ).toEqual({ best: 0 });
    expect(
      homeworkReached([codeDay("a", "2026-09-01", { interactions: 49, outsideSchool: 49 })]),
    ).toEqual({ best: 0 });
  });

  it("is a lifetime predicate: a day that met it stays the date even if later use was in school", () => {
    const days = [
      codeDay("a", "2026-09-01", { interactions: 60, outsideSchool: 60 }),
      codeDay("a", "2026-09-02", { interactions: 500, outsideSchool: 0 }),
    ];
    expect(homeworkReached(days).reachedOn).toBe("2026-09-01");
  });
});
