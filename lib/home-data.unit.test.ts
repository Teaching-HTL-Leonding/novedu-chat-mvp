// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadStudentFacts: vi.fn(),
  listGrants: vi.fn(),
  insertGrants: vi.fn(),
  loadTeacherFacts: vi.fn(),
}));
vi.mock("@/lib/student-facts-store", () => ({ loadStudentFacts: mocks.loadStudentFacts }));
vi.mock("@/lib/teacher-facts-store", () => ({ loadTeacherFacts: mocks.loadTeacherFacts }));
vi.mock("@/lib/achievement-store", () => ({
  listGrants: mocks.listGrants,
  insertGrants: mocks.insertGrants,
}));

import type { StudentAchievement } from "@/lib/achievements/catalog";
import type { UsageDay } from "@/lib/achievements/derive";
import type { TeacherCode, TeacherFacts } from "@/lib/achievements/teacher";
import {
  buildStudentHome,
  buildTeacherHome,
  getStudentHome,
  getTeacherHome,
  invalidateHome,
  loadStudentHome,
  resetHomeCacheForTests,
} from "@/lib/home-data";

const NOW = new Date("2026-10-04T10:00:00Z"); // Sunday 4 Oct, Vienna
const TODAY = "2026-10-04";

const day = (date: string, extra: Partial<UsageDay> = {}): UsageDay => ({
  date,
  activeHours: 2,
  userMessages: 0,
  quizAnswers: 0,
  writingSaves: 0,
  codingRequests: 0,
  codingHours: 0,
  ...extra,
});

// Two active weeks in a row (Two in a Row, dated Mon 28 Sep) and 12 quiz answers
// (First Ten Answers, dated 22 Sep).
const USAGE = [day("2026-09-22", { quizAnswers: 12 }), day("2026-09-28"), day("2026-10-01")];

beforeEach(() => {
  vi.clearAllMocks();
  resetHomeCacheForTests();
  mocks.loadStudentFacts.mockResolvedValue({ usage: USAGE, keys: [], quiz: [], reports: [] });
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

  it("grants Connected from the keys group, dated to the key's issue day", async () => {
    mocks.loadStudentFacts.mockResolvedValue({
      usage: USAGE,
      keys: ["2026-09-30"],
      quiz: [],
      reports: [],
    });
    const home = await loadStudentHome("u1", NOW);
    expect(mocks.insertGrants).toHaveBeenCalledWith(
      "u1",
      expect.arrayContaining([{ id: "coding-connected", qualifiedOn: "2026-09-30" }]),
      [],
    );
    expect(home.newIds).toContain("coding-connected");
  });

  it("a failed keys group is never read as zero: its badges are left out, the rest renders, nothing is cached", async () => {
    mocks.loadStudentFacts.mockResolvedValue({
      usage: USAGE,
      keys: undefined,
      quiz: [],
      reports: [],
    });
    const home = await loadStudentHome("u1", NOW);
    const inserted = (mocks.insertGrants.mock.calls[0]?.[1] ?? []) as { id: string }[];
    expect(inserted.map((g) => g.id)).not.toContain("coding-connected");
    expect(home.complete).toBe(false);
    expect(home.level).toBeDefined();
    const coding = home.badges?.families.find((f) => f.id === "coding");
    const ids = [...(coding?.shown ?? []), ...(coding?.more ?? [])].map((b) => b.id);
    expect(ids).not.toContain("coding-connected");
    expect(ids).not.toContain("coding-toolbelt");
    expect(ids).toContain("coding-first-request");
  });

  it("a failed usage group still grants from the keys group", async () => {
    mocks.loadStudentFacts.mockResolvedValue({
      usage: undefined,
      keys: ["2026-09-30"],
      quiz: [],
      reports: [],
    });
    await loadStudentHome("u1", NOW);
    expect(mocks.insertGrants).toHaveBeenCalledWith(
      "u1",
      [{ id: "coding-connected", qualifiedOn: "2026-09-30" }],
      [],
    );
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
    mocks.loadStudentFacts.mockResolvedValue({ usage: undefined, keys: [], quiz: [], reports: [] });
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
      { usage: USAGE, keys: [], quiz: [], reports: [] },
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
    const home = buildStudentHome({ usage: USAGE, keys: [], quiz: [], reports: [] }, [], TODAY, [
      hidden,
    ]);
    const json = JSON.stringify(home);
    expect(json).not.toContain("Very Secret Name");
    expect(json).not.toContain("A very secret criterion");
    expect(json).not.toContain("secret-thing");
  });

  it("an empty history yields level 1, no streak, an empty calendar and nothing new", () => {
    const home = buildStudentHome({ usage: [], keys: [], quiz: [], reports: [] }, [], TODAY);
    expect(home.level).toEqual({ level: 1, xp: 0, levelStart: 0, nextLevelStart: 100 });
    expect(home.streak?.weeks).toBe(0);
    expect(home.calendar?.activeDays).toBe(0);
    expect(home.newIds).toEqual([]);
    expect(home.almostThere).toEqual([]);
  });
});

describe("the quiz band", () => {
  const attempt = (code: string, date: string, correct: number, total: number, note = "") => ({
    id: `id-${code}-${date}`,
    code,
    correct,
    partial: 0,
    incorrect: total - correct,
    unanswered: 0,
    total,
    finishedAt: new Date(`${date}T10:00:00Z`),
    finishedOn: date,
    note,
    open: true,
  });

  it("builds medals and nudges from the quiz group, labelled by note or code", () => {
    const quiz = [
      attempt("linked", "2026-09-18", 4, 5, "Linked lists"),
      attempt("linked", "2026-09-25", 3, 5, "Linked lists"),
      attempt("recursion", "2026-09-17", 5, 5),
      attempt("sorting", "2026-09-15", 1, 5, "  "),
    ];
    const home = buildStudentHome({ usage: USAGE, keys: [], quiz, reports: [] }, [], TODAY);
    expect(home.quiz).toEqual({
      quizzes: 3,
      medals: { gold: 1, silver: 1, bronze: 0 },
      nudges: [
        // Oldest last attempt first; recursion is gold and only 17 days old → listed too.
        {
          code: "sorting",
          label: "sorting",
          medal: undefined,
          lastPercent: 20,
          lastOn: "2026-09-15",
          bestPercent: 20,
        },
        {
          code: "recursion",
          label: "recursion",
          medal: "gold",
          lastPercent: 100,
          lastOn: "2026-09-17",
          bestPercent: 100,
        },
        {
          code: "linked",
          label: "Linked lists",
          medal: "silver",
          lastPercent: 60,
          lastOn: "2026-09-25",
          bestPercent: 80,
        },
      ],
    });
  });

  it("a failed quiz group is never read as zero: no band, no quiz badges, not cached", async () => {
    mocks.loadStudentFacts.mockResolvedValue({
      usage: USAGE,
      keys: [],
      quiz: undefined,
      reports: [],
    });
    const home = await loadStudentHome("u1", NOW);
    expect(home.quiz).toBeUndefined();
    expect(home.complete).toBe(false);
    const family = home.badges?.families.find((f) => f.id === "quiz");
    expect([...(family?.shown ?? []), ...(family?.more ?? [])]).toEqual([]);
    // The other sections render.
    expect(home.level).toBeDefined();
  });

  it("a failed reports group leaves only Bug Hunter unevaluated", async () => {
    mocks.loadStudentFacts.mockResolvedValue({
      usage: USAGE,
      keys: [],
      quiz: [],
      reports: undefined,
    });
    const home = await loadStudentHome("u1", NOW);
    expect(home.complete).toBe(false);
    expect(home.quiz).toEqual({
      quizzes: 0,
      medals: { gold: 0, silver: 0, bronze: 0 },
      nudges: [],
    });
  });

  it("grants Bug Hunter from the reports group, dated to the resolution day", async () => {
    mocks.loadStudentFacts.mockResolvedValue({
      usage: USAGE,
      keys: [],
      quiz: [],
      reports: ["2026-10-02"],
    });
    await loadStudentHome("u1", NOW);
    expect(mocks.insertGrants).toHaveBeenCalledWith(
      "u1",
      expect.arrayContaining([{ id: "bug-hunter", qualifiedOn: "2026-10-02" }]),
      [],
    );
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

// ---------------------------------------------------------------------------
// Teacher dashboard

const T_NOW = new Date("2026-10-04T17:30:00Z"); // Sun 4 Oct, 19:30 Vienna
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const tAt = (offsetMs: number) => new Date(T_NOW.getTime() + offsetMs);

const tCode = (id: string, extra: Partial<TeacherCode> = {}): TeacherCode => ({
  code: id,
  module: "quiz",
  note: `Note ${id}`,
  validFrom: null,
  validUntil: null,
  createdAt: tAt(-30 * DAY),
  ...extra,
});

const FACTS: TeacherFacts = {
  codes: [
    // Ends today 21:59Z = 23:59 local; another one ends Tue 6 Oct 14:00 local.
    tCode("TODAY", { validUntil: new Date("2026-10-04T21:59:00Z"), note: "  " }),
    tCode("TUESDAY", { validUntil: new Date("2026-10-06T12:00:00Z"), module: "tutor" }),
    tCode("UNUSED", { createdAt: tAt(-12 * DAY) }),
    tCode("ENDED", { validUntil: tAt(-DAY) }),
  ],
  usage: [
    {
      code: "TUESDAY",
      interactions: 40,
      outsideSchool: 10,
      quizAnswers: 5,
      inputTokens: 1000,
      outputTokens: 100,
    },
    {
      code: "TODAY",
      interactions: 0,
      outsideSchool: 0,
      quizAnswers: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    {
      code: "ENDED",
      interactions: 3,
      outsideSchool: 3,
      quizAnswers: 3,
      inputTokens: 10,
      outputTokens: 1,
    },
  ],
  conversations: 7,
  students: 12,
  reports: [
    { code: "TUESDAY", open: 2 },
    { code: "TODAY", open: 1 },
  ],
};

describe("buildTeacherHome", () => {
  it("builds the KPIs over the teacher's codes", () => {
    const home = buildTeacherHome(FACTS, T_NOW);
    expect(home.complete).toBe(true);
    expect(home.hasCodes).toBe(true);
    expect(home.kpis).toEqual({
      liveCodes: 3,
      students: 12,
      conversations: 7,
      quizAnswers: 8,
      inputTokens: 1010,
      outputTokens: 101,
    });
  });

  it("lists closing-soon codes with their Vienna-local end, the note-or-code label", () => {
    const { closingSoon } = buildTeacherHome(FACTS, T_NOW);
    expect(closingSoon).toEqual({
      total: 2,
      more: 0,
      items: [
        {
          code: "TODAY",
          label: "TODAY",
          module: "quiz",
          closesOn: "2026-10-04",
          closesAt: "23:59",
        },
        {
          code: "TUESDAY",
          label: "Note TUESDAY",
          module: "tutor",
          closesOn: "2026-10-06",
          closesAt: "14:00",
        },
      ],
    });
  });

  it("counts open reports and lists their codes, most open first", () => {
    const { openReports } = buildTeacherHome(FACTS, T_NOW);
    expect(openReports?.total).toBe(3);
    expect(openReports?.items.map((i) => [i.code, i.open])).toEqual([
      ["TUESDAY", 2],
      ["TODAY", 1],
    ]);
  });

  it("lists never-used codes with their creation day; a code with a usage row is used", () => {
    const { neverUsed } = buildTeacherHome(FACTS, T_NOW);
    expect(neverUsed).toEqual({
      total: 1,
      more: 0,
      items: [{ code: "UNUSED", label: "Note UNUSED", module: "quiz", createdOn: "2026-09-22" }],
    });
  });

  it("ranks the top activities with the share outside school hours", () => {
    const { top } = buildTeacherHome(FACTS, T_NOW);
    expect(top).toEqual([
      {
        code: "TUESDAY",
        label: "Note TUESDAY",
        module: "tutor",
        interactions: 40,
        outsidePercent: 25,
      },
      { code: "ENDED", label: "Note ENDED", module: "quiz", interactions: 3, outsidePercent: 100 },
    ]);
  });

  it("caps every list at five codes and says how many more there are", () => {
    const codes = Array.from({ length: 7 }, (_, i) =>
      tCode(`C${i}`, { validUntil: tAt((i + 1) * HOUR) }),
    );
    const home = buildTeacherHome({ ...FACTS, codes, reports: [] }, T_NOW);
    expect(home.closingSoon?.total).toBe(7);
    expect(home.closingSoon?.items.map((i) => i.code)).toEqual(["C0", "C1", "C2", "C3", "C4"]);
    expect(home.closingSoon?.more).toBe(2);
    expect(home.openReports).toEqual({ total: 0, more: 0, items: [] });
  });

  it("a teacher without codes has no codes, empty lists and zero live codes", () => {
    const home = buildTeacherHome(
      { codes: [], usage: [], conversations: 0, students: 0, reports: [] },
      T_NOW,
    );
    expect(home.hasCodes).toBe(false);
    expect(home.kpis.liveCodes).toBe(0);
    expect(home.top).toEqual([]);
  });

  it("a failed group is unavailable where it is needed — never read as 0 or empty", () => {
    const home = buildTeacherHome({ ...FACTS, usage: undefined, students: undefined }, T_NOW);
    expect(home.complete).toBe(false);
    expect(home.kpis.students).toBeUndefined();
    expect(home.kpis.quizAnswers).toBeUndefined();
    expect(home.kpis.inputTokens).toBeUndefined();
    expect(home.neverUsed).toBeUndefined();
    expect(home.top).toBeUndefined();
    // Groups that loaded still render.
    expect(home.kpis.liveCodes).toBe(3);
    expect(home.closingSoon?.total).toBe(2);
    expect(home.openReports?.total).toBe(3);
  });

  it("failed codes leave everything that names a code unavailable", () => {
    const home = buildTeacherHome({ ...FACTS, codes: undefined }, T_NOW);
    expect(home.hasCodes).toBeUndefined();
    expect(home.kpis.liveCodes).toBeUndefined();
    expect(home.closingSoon).toBeUndefined();
    expect(home.openReports).toBeUndefined();
    expect(home.neverUsed).toBeUndefined();
    expect(home.top).toBeUndefined();
    expect(home.kpis.conversations).toBe(7);
  });
});

describe("getTeacherHome (cached)", () => {
  it("loads the teacher's own facts once per minute, apart from the student home", async () => {
    mocks.loadTeacherFacts.mockResolvedValue(FACTS);
    await getTeacherHome("t-cache");
    await getTeacherHome("t-cache");
    expect(mocks.loadTeacherFacts).toHaveBeenCalledTimes(1);
    expect(mocks.loadTeacherFacts).toHaveBeenCalledWith("t-cache", expect.any(Date));
    expect(mocks.loadStudentFacts).not.toHaveBeenCalled();

    invalidateHome("t-cache");
    await getTeacherHome("t-cache");
    expect(mocks.loadTeacherFacts).toHaveBeenCalledTimes(2);
  });

  it("does not cache an incomplete load", async () => {
    mocks.loadTeacherFacts.mockResolvedValue({ ...FACTS, conversations: undefined });
    await getTeacherHome("t-fail");
    await getTeacherHome("t-fail");
    expect(mocks.loadTeacherFacts).toHaveBeenCalledTimes(2);
  });
});
