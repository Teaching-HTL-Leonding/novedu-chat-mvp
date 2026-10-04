import { cache } from "react";
import { insertGrants, listGrants } from "@/lib/achievement-store";
import {
  type Achievement,
  availableGroups,
  type BadgeIcon,
  FACT_GROUPS,
  STUDENT_CATALOG,
  STUDENT_FAMILIES,
  type StudentAchievement,
  type StudentFacts,
  TEACHER_CATALOG,
  TEACHER_FAMILIES,
  type TeacherAchievement,
} from "@/lib/achievements/catalog";
import {
  activeDays,
  activeDaysThisWeek,
  heatmap,
  inHeatmap,
  recentWeeks,
  weeklyStreak,
} from "@/lib/achievements/derive";
import {
  almostThere,
  badgeView,
  type Evaluated,
  evaluate,
  type Grant,
  newGrants,
} from "@/lib/achievements/evaluate";
import {
  type Medal,
  medalCounts,
  quizSummaries,
  refreshNudges,
  scorePercent,
} from "@/lib/achievements/quiz";
import {
  availableTeacherGroups,
  closingSoon,
  codeUsage,
  LIST_MAX,
  neverUsed,
  outsideSchoolPercent,
  reportedCodes,
  TEACHER_FACT_GROUPS,
  type TeacherCode,
  type TeacherFacts,
  topActivities,
  usageTotals,
  windowOpen,
} from "@/lib/achievements/teacher";
import { HOME_TIME_ZONE, type LocalDate, localDateOf, todayLocal } from "@/lib/achievements/time";
import { levelFor, xpTotal } from "@/lib/achievements/xp";
import type { CodeModule } from "@/lib/code-modules/types";
import { createHomeCache } from "@/lib/home-cache";
import { loadStudentFacts } from "@/lib/student-facts-store";
import { loadTeacherFacts } from "@/lib/teacher-facts-store";

// The start page's data (docs/home.md). Both audiences: facts + stored grants →
// evaluation of the audience's catalog → new grants inserted BEFORE returning →
// a plain view model; a hidden achievement's name and criterion appear in it
// only once earned. Students get their progress; teachers the dashboard over
// their OWN codes plus their badges. Only plain data leaves this module.
//
// SERVER-ONLY: uses the database. Never import from client components.

/** One badge as the page shows it. */
export interface BadgeItem {
  id: string;
  name: string;
  criterion: string;
  icon: BadgeIcon;
  family: string;
  xp: number;
  earned: boolean;
  /** Earned: the day the badge is pinned to. */
  qualifiedOn?: LocalDate;
  /** Earned and not yet shown on an earlier visit. */
  isNew: boolean;
  /** Unearned: progress toward the target. */
  current?: number;
  target?: number;
}

export interface CalendarCell {
  date: LocalDate;
  activeHours: number;
  level: 0 | 1 | 2 | 3;
  future: boolean;
  today: boolean;
  /** Badges pinned to this day (empty when the grants are unavailable). */
  pins: BadgeItem[];
}

/** One "Time to refresh" entry: a saved quiz worth retaking. */
export interface QuizNudge {
  code: string;
  /** The code's note, or the code when it has none. */
  label: string;
  /** The best attempt's medal; undefined = none yet. */
  medal?: Medal;
  /** Whole percent, rounded down. */
  lastPercent: number;
  lastOn: LocalDate;
  bestPercent: number;
}

export interface StudentHome {
  today: LocalDate;
  /** Level + XP: needs usage and grants. */
  level?: { level: number; xp: number; levelStart: number; nextLevelStart: number };
  /** The weekly streak: needs usage. */
  streak?: { weeks: number; recent: boolean[]; thisWeekDays: number };
  /** The 26-week calendar: needs usage; pins need grants. */
  calendar?: {
    cells: CalendarCell[];
    monthStarts: (number | null)[];
    activeDays: number;
    badges: number;
    pinsAvailable: boolean;
  };
  /** Ids of earned badges not yet seen — the strip's count. Needs grants. */
  newIds?: string[];
  /** Needs usage and grants. */
  almostThere?: BadgeItem[];
  /** Medals and refresh nudges from the saved quiz results: needs the quiz group. */
  quiz?: {
    /** Quizzes with at least one saved result. */
    quizzes: number;
    medals: Record<Medal, number>;
    nudges: QuizNudge[];
  };
  /** Needs usage and grants. */
  badges?: BadgeBoard;
  /** Every fact group loaded and every new grant stored — only then is the result cached. */
  complete: boolean;
}

/** The Badges section: family by family, the default view and the rest. */
export interface BadgeBoard {
  earned: number;
  families: { id: string; label: string; shown: BadgeItem[]; more: BadgeItem[] }[];
}

function toItem<F, G extends string>({ achievement, status }: Evaluated<F, G>): BadgeItem {
  const base = {
    id: achievement.id,
    name: achievement.name,
    criterion: achievement.criterion,
    icon: achievement.icon,
    family: achievement.family,
    xp: achievement.xp,
  };
  if (status.kind === "earned") {
    return { ...base, earned: true, qualifiedOn: status.qualifiedOn, isNew: status.isNew };
  }
  if (status.kind === "progress") {
    return { ...base, earned: false, isNew: false, current: status.current, target: status.target };
  }
  return { ...base, earned: false, isNew: false };
}

/**
 * Builds the view model from loaded facts and grants. `grants` is undefined when
 * the grants group (or the new-grant insert) failed. Exported for tests.
 */
export function buildStudentHome(
  facts: StudentFacts,
  grants: Grant[] | undefined,
  today: LocalDate,
  catalog: readonly StudentAchievement[] = STUDENT_CATALOG,
): StudentHome {
  const usage = facts.usage;
  const available = availableGroups(facts);
  const home: StudentHome = {
    today,
    complete: FACT_GROUPS.every((group) => available.has(group)) && grants !== undefined,
  };

  const evaluated = grants ? evaluate(catalog, facts, available, grants) : undefined;
  const earned = evaluated?.filter((e) => e.status.kind === "earned") ?? [];

  if (usage) {
    home.streak = {
      weeks: weeklyStreak(usage, today),
      recent: recentWeeks(usage, today, 8),
      thisWeekDays: activeDaysThisWeek(usage, today),
    };

    const pinsByDay = new Map<LocalDate, BadgeItem[]>();
    for (const entry of earned) {
      const item = toItem(entry);
      if (!item.qualifiedOn || !inHeatmap(item.qualifiedOn, today)) continue;
      const list = pinsByDay.get(item.qualifiedOn);
      if (list) list.push(item);
      else pinsByDay.set(item.qualifiedOn, [item]);
    }
    const map = heatmap(usage, today);
    const cells = map.cells.map((cell) => ({ ...cell, pins: pinsByDay.get(cell.date) ?? [] }));
    home.calendar = {
      cells,
      monthStarts: map.monthStarts,
      activeDays: cells.filter((c) => c.activeHours > 0).length,
      badges: cells.reduce((n, c) => n + c.pins.length, 0),
      pinsAvailable: grants !== undefined,
    };
  }

  if (facts.quiz) {
    const quizzes = quizSummaries(facts.quiz);
    home.quiz = {
      quizzes: quizzes.length,
      medals: medalCounts(quizzes),
      nudges: refreshNudges(quizzes, today).map((q) => ({
        code: q.code,
        label: q.note.trim() || q.code,
        medal: q.medal,
        lastPercent: scorePercent(q.last),
        lastOn: q.last.finishedOn,
        bestPercent: scorePercent(q.best),
      })),
    };
  }

  if (evaluated) home.newIds = newIdsOf(evaluated);

  if (usage && evaluated) {
    home.level = levelFor(
      xpTotal(
        activeDays(usage).length,
        earned.map((e) => e.achievement.xp),
      ),
    );
    home.almostThere = almostThere(evaluated).map(toItem);
    home.badges = badgeBoard(evaluated, STUDENT_FAMILIES);
  }

  return home;
}

/** The ids of earned grants not yet seen — the strip's count. */
function newIdsOf<F, G extends string>(evaluated: readonly Evaluated<F, G>[]): string[] {
  return evaluated
    .filter((e) => e.status.kind === "earned" && e.status.isNew)
    .map((e) => e.achievement.id);
}

/** The Badges section's data, family by family in `families` order. */
function badgeBoard<F, G extends string>(
  evaluated: readonly Evaluated<F, G>[],
  families: readonly { id: string; label: string }[],
): BadgeBoard {
  const labels = new Map(families.map((f) => [f.id, f.label]));
  return {
    earned: evaluated.filter((e) => e.status.kind === "earned").length,
    families: badgeView(
      evaluated,
      families.map((f) => f.id),
    ).map((view) => ({
      id: view.family,
      label: labels.get(view.family) ?? view.family,
      shown: view.shown.map(toItem),
      more: view.more.map(toItem),
    })),
  };
}

/**
 * Stores the grants a load newly qualifies for, before anything is built, so the
 * page renders only durable state. Rules whose groups failed are `unavailable`,
 * never granted from zeros. Returns the stored grants afterwards, or undefined
 * when the grants could not be read or the insert failed.
 */
async function settleGrants<F, G extends string>(
  userId: string,
  catalog: readonly Achievement<F, G>[],
  facts: F,
  available: ReadonlySet<G>,
  stored: Grant[] | undefined,
): Promise<Grant[] | undefined> {
  if (!stored) return undefined;
  const pending = newGrants(evaluate(catalog, facts, available, stored));
  return pending.length > 0 ? insertGrants(userId, pending, stored) : stored;
}

/**
 * Loads and evaluates one student's home: facts and grants in parallel, then
 * the new grants inserted before anything is built, so the page renders only
 * durable state. A failed insert makes the grants unavailable for this load.
 */
export async function loadStudentHome(userId: string, now: Date): Promise<StudentHome> {
  const today = todayLocal(now);
  const [facts, stored] = await Promise.all([loadStudentFacts(userId), listGrants(userId)]);
  const grants = await settleGrants(userId, STUDENT_CATALOG, facts, availableGroups(facts), stored);
  return buildStudentHome(facts, grants, today);
}

const homeCache = createHomeCache<StudentHome>({ cacheable: (home) => home.complete });

const studentKey = (userId: string) => `${userId}:student`;
const teacherKey = (userId: string) => `${userId}:teacher`;

/**
 * The student home for the session user: reused for 60 s per user, one load in
 * flight per user, and React `cache()` so the page's sections share it within
 * a request.
 */
export const getStudentHome = cache(
  (userId: string): Promise<StudentHome> =>
    homeCache.get(studentKey(userId), () => loadStudentHome(userId, new Date())),
);

// ---------------------------------------------------------------------------
// Teacher dashboard

/** One of the teacher's codes as the dashboard names it. */
export interface TeacherCodeItem {
  code: string;
  /** The code's note, or the code when it has none. */
  label: string;
  module: CodeModule;
}

/** An attention counter: how many, the first `LIST_MAX` codes, and how many codes are not listed. */
export interface AttentionList<T> {
  total: number;
  items: T[];
  more: number;
}

export interface ClosingItem extends TeacherCodeItem {
  /** The local date and time (`HH:MM`) the window ends. */
  closesOn: LocalDate;
  closesAt: string;
}

export interface ReportedItem extends TeacherCodeItem {
  open: number;
}

export interface UnusedItem extends TeacherCodeItem {
  createdOn: LocalDate;
}

export interface TopActivity extends TeacherCodeItem {
  interactions: number;
  /** Whole percent of the interactions outside school hours. */
  outsidePercent: number;
}

/** Each KPI is undefined when the fact group it needs failed — never 0. */
export interface TeacherKpis {
  liveCodes?: number;
  students?: number;
  conversations?: number;
  quizAnswers?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TeacherHome {
  today: LocalDate;
  /** Whether the teacher created any code; undefined when the codes group failed. */
  hasCodes?: boolean;
  /** Needs the codes. */
  closingSoon?: AttentionList<ClosingItem>;
  /** Needs the codes and the reports. */
  openReports?: AttentionList<ReportedItem>;
  /** Needs the codes and the usage. */
  neverUsed?: AttentionList<UnusedItem>;
  kpis: TeacherKpis;
  /** Needs the codes and the usage. */
  top?: TopActivity[];
  /** Ids of earned badges not yet seen — the strip's count. Needs grants. */
  newIds?: string[];
  /** The teacher's badges: needs grants; a rule whose groups failed is left out. */
  badges?: BadgeBoard;
  /** Every fact group loaded and every new grant stored — only then is the result cached. */
  complete: boolean;
}

const localTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: HOME_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function codeItem(code: TeacherCode): TeacherCodeItem {
  return { code: code.code, label: code.note.trim() || code.code, module: code.module };
}

/**
 * Builds the teacher dashboard from loaded facts and stored grants. Every list
 * and KPI is present only when every fact group it needs loaded; `grants` is
 * undefined when the grants group (or the new-grant insert) failed. Exported for
 * tests.
 */
export function buildTeacherHome(
  facts: TeacherFacts,
  grants: Grant[] | undefined,
  now: Date,
  catalog: readonly TeacherAchievement[] = TEACHER_CATALOG,
): TeacherHome {
  const { codes } = facts;
  const usage = facts.usage && codeUsage(facts.usage, now);
  const reports = facts.reports?.open;
  const home: TeacherHome = {
    today: todayLocal(now),
    kpis: {
      conversations: facts.conversations,
      students: facts.students?.total,
    },
    complete:
      TEACHER_FACT_GROUPS.every((group) => facts[group] !== undefined) && grants !== undefined,
  };

  if (grants) {
    const evaluated = evaluate(catalog, facts, availableTeacherGroups(facts), grants);
    home.newIds = newIdsOf(evaluated);
    home.badges = badgeBoard(evaluated, TEACHER_FAMILIES);
  }

  if (usage) Object.assign(home.kpis, usageTotals(usage));
  if (!codes) return home;

  home.hasCodes = codes.length > 0;
  home.kpis.liveCodes = codes.filter((code) => windowOpen(code, now)).length;
  const byCode = new Map(codes.map((code) => [code.code, code]));

  const closing = closingSoon(codes, now);
  home.closingSoon = {
    total: closing.length,
    more: Math.max(0, closing.length - LIST_MAX),
    items: closing.slice(0, LIST_MAX).map((code) => ({
      ...codeItem(code),
      // closingSoon() keeps only codes with an end.
      closesOn: localDateOf(code.validUntil as Date),
      closesAt: localTime.format(code.validUntil as Date),
    })),
  };

  if (reports) {
    const reported = reportedCodes(reports).filter((r) => byCode.has(r.code));
    home.openReports = {
      total: reported.reduce((sum, r) => sum + r.open, 0),
      more: Math.max(0, reported.length - LIST_MAX),
      items: reported.slice(0, LIST_MAX).map((r) => ({
        ...codeItem(byCode.get(r.code) as TeacherCode),
        open: r.open,
      })),
    };
  }

  if (usage) {
    const unused = neverUsed(codes, usage, now);
    home.neverUsed = {
      total: unused.length,
      more: Math.max(0, unused.length - LIST_MAX),
      items: unused.slice(0, LIST_MAX).map((code) => ({
        ...codeItem(code),
        createdOn: localDateOf(code.createdAt),
      })),
    };
    home.top = topActivities(usage.filter((u) => byCode.has(u.code))).map((u) => ({
      ...codeItem(byCode.get(u.code) as TeacherCode),
      interactions: u.interactions,
      outsidePercent: outsideSchoolPercent(u),
    }));
  }

  return home;
}

/**
 * Loads one teacher's dashboard: the six fact groups and the grants in parallel,
 * then the new grants stored, then the view model.
 */
export async function loadTeacherHome(userId: string, now: Date): Promise<TeacherHome> {
  const [facts, stored] = await Promise.all([loadTeacherFacts(userId, now), listGrants(userId)]);
  const grants = await settleGrants(
    userId,
    TEACHER_CATALOG,
    facts,
    availableTeacherGroups(facts),
    stored,
  );
  return buildTeacherHome(facts, grants, now);
}

const teacherCache = createHomeCache<TeacherHome>({ cacheable: (home) => home.complete });

/**
 * The teacher dashboard for the session user: reused for 60 s per user, one
 * load in flight per user, shared by the page's sections within a request.
 */
export const getTeacherHome = cache(
  (userId: string): Promise<TeacherHome> =>
    teacherCache.get(teacherKey(userId), () => loadTeacherHome(userId, new Date())),
);

/** Drops the user's cached home (both shapes) after one of their own writes. */
export function invalidateHome(userId: string): void {
  homeCache.invalidate(studentKey(userId));
  teacherCache.invalidate(teacherKey(userId));
}

/** Test seam. */
export function resetHomeCacheForTests(): void {
  homeCache.clear();
  teacherCache.clear();
}
