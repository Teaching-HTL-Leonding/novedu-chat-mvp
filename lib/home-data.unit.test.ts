// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadStudentFacts: vi.fn(),
  listGrants: vi.fn(),
  insertGrants: vi.fn(),
}));
vi.mock("@/lib/student-facts-store", () => ({ loadStudentFacts: mocks.loadStudentFacts }));
vi.mock("@/lib/achievement-store", () => ({
  listGrants: mocks.listGrants,
  insertGrants: mocks.insertGrants,
}));

import type { StudentAchievement } from "@/lib/achievements/catalog";
import type { UsageDay } from "@/lib/achievements/derive";
import {
  buildStudentHome,
  getStudentHome,
  invalidateHome,
  loadStudentHome,
  resetHomeCacheForTests,
} from "@/lib/home-data";

const NOW = new Date("2026-10-04T10:00:00Z"); // Sunday 4 Oct, Vienna
const TODAY = "2026-10-04";

const day = (date: string, extra: Partial<UsageDay> = {}): UsageDay => ({
  date,
  activeHours: 2,
  quizAnswers: 0,
  writingSaves: 0,
  ...extra,
});

// Two active weeks in a row (Two in a Row, dated Mon 28 Sep) and 12 quiz answers
// (First Ten Answers, dated 22 Sep).
const USAGE = [day("2026-09-22", { quizAnswers: 12 }), day("2026-09-28"), day("2026-10-01")];

beforeEach(() => {
  vi.clearAllMocks();
  resetHomeCacheForTests();
  mocks.loadStudentFacts.mockResolvedValue({ usage: USAGE });
  mocks.listGrants.mockResolvedValue([]);
  mocks.insertGrants.mockImplementation(
    async (_user, grants: { id: string; qualifiedOn: string }[]) =>
      grants.map((g) => ({ ...g, seenAt: null })),
  );
});

describe("loadStudentHome", () => {
  it("inserts the new grants before building, then shows them as new", async () => {
    const home = await loadStudentHome("u1", NOW);
    expect(mocks.insertGrants).toHaveBeenCalledWith(
      "u1",
      [
        { id: "weekly-streak-2", qualifiedOn: "2026-09-28" },
        { id: "quiz-answers-10", qualifiedOn: "2026-09-22" },
      ],
      [],
    );
    expect(home.complete).toBe(true);
    expect(home.newIds).toEqual(["weekly-streak-2", "quiz-answers-10"]);
    // 3 active days × 10 + 20 + 20.
    expect(home.level).toEqual({ level: 1, xp: 70, levelStart: 0, nextLevelStart: 100 });
    expect(home.streak).toEqual({
      weeks: 2,
      recent: [false, false, false, false, false, false, true, true],
      thisWeekDays: 2,
    });
  });

  it("runs no insert when nothing new qualifies", async () => {
    mocks.listGrants.mockResolvedValue([
      { id: "weekly-streak-2", qualifiedOn: "2026-09-28", seenAt: new Date() },
      { id: "quiz-answers-10", qualifiedOn: "2026-09-22", seenAt: new Date() },
    ]);
    const home = await loadStudentHome("u1", NOW);
    expect(mocks.insertGrants).not.toHaveBeenCalled();
    expect(home.newIds).toEqual([]);
  });

  it("a failed insert makes the grant sections unavailable, keeps the calendar, and is not complete", async () => {
    mocks.insertGrants.mockResolvedValue(undefined);
    const home = await loadStudentHome("u1", NOW);
    expect(home.complete).toBe(false);
    expect(home.level).toBeUndefined();
    expect(home.badges).toBeUndefined();
    expect(home.almostThere).toBeUndefined();
    expect(home.newIds).toBeUndefined();
    expect(home.streak?.weeks).toBe(2);
    expect(home.calendar?.pinsAvailable).toBe(false);
    expect(home.calendar?.cells.every((c) => c.pins.length === 0)).toBe(true);
  });

  it("a failed usage group is never read as zero: no streak, calendar or level — and no insert", async () => {
    mocks.loadStudentFacts.mockResolvedValue({ usage: undefined });
    mocks.listGrants.mockResolvedValue([
      { id: "weekly-streak-2", qualifiedOn: "2026-09-28", seenAt: null },
    ]);
    const home = await loadStudentHome("u1", NOW);
    expect(mocks.insertGrants).not.toHaveBeenCalled();
    expect(home.complete).toBe(false);
    expect(home.streak).toBeUndefined();
    expect(home.calendar).toBeUndefined();
    expect(home.level).toBeUndefined();
    expect(home.almostThere).toBeUndefined();
    // The strip only needs the stored grants.
    expect(home.newIds).toEqual(["weekly-streak-2"]);
  });
});

describe("buildStudentHome", () => {
  it("pins grants on their qualified_on day inside the window, stacking same-day grants", () => {
    const home = buildStudentHome(
      { usage: USAGE },
      [
        { id: "weekly-streak-2", qualifiedOn: "2026-09-28", seenAt: null },
        { id: "week-days-3", qualifiedOn: "2026-09-28", seenAt: new Date() },
        { id: "active-days-10", qualifiedOn: "2025-01-01", seenAt: new Date() }, // before the window
      ],
      TODAY,
    );
    const pinned = home.calendar?.cells.filter((c) => c.pins.length > 0) ?? [];
    expect(pinned.map((c) => [c.date, c.pins.map((p) => p.id)])).toEqual([
      ["2026-09-28", ["weekly-streak-2", "week-days-3"]],
    ]);
    expect(home.calendar?.badges).toBe(2);
    expect(home.calendar?.activeDays).toBe(3);
  });

  it("an unearned hidden achievement's name and criterion appear nowhere in the page data", () => {
    const hidden: StudentAchievement = {
      id: "secret-thing",
      audience: "student",
      family: "rhythm",
      order: 99,
      icon: "flame",
      name: "Very Secret Name",
      criterion: "A very secret criterion",
      hidden: true,
      xp: 50,
      needs: ["usage"],
      evaluate: () => ({ earned: false, current: 1, target: 2 }),
    };
    const home = buildStudentHome({ usage: USAGE }, [], TODAY, [hidden]);
    const json = JSON.stringify(home);
    expect(json).not.toContain("Very Secret Name");
    expect(json).not.toContain("A very secret criterion");
    expect(json).not.toContain("secret-thing");
  });

  it("an empty history yields level 1, no streak, an empty calendar and nothing new", () => {
    const home = buildStudentHome({ usage: [] }, [], TODAY);
    expect(home.level).toEqual({ level: 1, xp: 0, levelStart: 0, nextLevelStart: 100 });
    expect(home.streak?.weeks).toBe(0);
    expect(home.calendar?.activeDays).toBe(0);
    expect(home.newIds).toEqual([]);
    expect(home.almostThere).toEqual([]);
  });
});

describe("getStudentHome (cached)", () => {
  it("serves a repeat visit without a statement and reloads after invalidation", async () => {
    await getStudentHome("u-cache");
    await getStudentHome("u-cache");
    expect(mocks.loadStudentFacts).toHaveBeenCalledTimes(1);
    expect(mocks.listGrants).toHaveBeenCalledTimes(1);

    invalidateHome("u-cache");
    await getStudentHome("u-cache");
    expect(mocks.loadStudentFacts).toHaveBeenCalledTimes(2);
  });

  it("does not cache an incomplete load", async () => {
    mocks.listGrants.mockResolvedValue(undefined);
    await getStudentHome("u-fail");
    await getStudentHome("u-fail");
    expect(mocks.loadStudentFacts).toHaveBeenCalledTimes(2);
  });
});
