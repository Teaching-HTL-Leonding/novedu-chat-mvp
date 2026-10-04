import { cache } from "react";
import { insertGrants, listGrants } from "@/lib/achievement-store";
import {
  availableGroups,
  type BadgeIcon,
  FACT_GROUPS,
  STUDENT_CATALOG,
  STUDENT_FAMILIES,
  type StudentAchievement,
  type StudentFacts,
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
import { type LocalDate, todayLocal } from "@/lib/achievements/time";
import { levelFor, xpTotal } from "@/lib/achievements/xp";
import { createHomeCache } from "@/lib/home-cache";
import { loadStudentFacts } from "@/lib/student-facts-store";

// The student start page's data (docs/home.md): facts + stored grants →
// evaluation → new grants inserted BEFORE returning → a plain view model. Only
// plain data leaves this module; a hidden achievement's name and criterion
// appear in it only once earned.
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
  badges?: {
    earned: number;
    families: { id: string; label: string; shown: BadgeItem[]; more: BadgeItem[] }[];
  };
  /** Every fact group loaded and every new grant stored — only then is the result cached. */
  complete: boolean;
}

function toItem({ achievement, status }: Evaluated<StudentFacts>): BadgeItem {
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

  if (evaluated) {
    home.newIds = earned
      .filter((e) => e.status.kind === "earned" && e.status.isNew)
      .map((e) => e.achievement.id);
  }

  if (usage && evaluated) {
    home.level = levelFor(
      xpTotal(
        activeDays(usage).length,
        earned.map((e) => e.achievement.xp),
      ),
    );
    home.almostThere = almostThere(evaluated).map(toItem);
    const labels = new Map<string, string>(STUDENT_FAMILIES.map((f) => [f.id, f.label]));
    home.badges = {
      earned: earned.length,
      families: badgeView(
        evaluated,
        STUDENT_FAMILIES.map((f) => f.id),
      ).map((view) => ({
        id: view.family,
        label: labels.get(view.family) ?? view.family,
        shown: view.shown.map(toItem),
        more: view.more.map(toItem),
      })),
    };
  }

  return home;
}

/**
 * Loads and evaluates one student's home: facts and grants in parallel, then
 * the new grants inserted before anything is built, so the page renders only
 * durable state. A failed insert makes the grants unavailable for this load.
 */
export async function loadStudentHome(userId: string, now: Date): Promise<StudentHome> {
  const today = todayLocal(now);
  const [facts, stored] = await Promise.all([loadStudentFacts(userId), listGrants(userId)]);
  let grants = stored;
  if (stored) {
    // Rules whose groups failed are `unavailable`, never granted from zeros.
    const pending = newGrants(evaluate(STUDENT_CATALOG, facts, availableGroups(facts), stored));
    if (pending.length > 0) grants = await insertGrants(userId, pending, stored);
  }
  return buildStudentHome(facts, grants, today);
}

const homeCache = createHomeCache<StudentHome>({ cacheable: (home) => home.complete });

const studentKey = (userId: string) => `${userId}:student`;

/**
 * The student home for the session user: reused for 60 s per user, one load in
 * flight per user, and React `cache()` so the page's sections share it within
 * a request.
 */
export const getStudentHome = cache(
  (userId: string): Promise<StudentHome> =>
    homeCache.get(studentKey(userId), () => loadStudentHome(userId, new Date())),
);

/** Drops the user's cached home after one of their own writes. */
export function invalidateHome(userId: string): void {
  homeCache.invalidate(studentKey(userId));
}

/** Test seam. */
export function resetHomeCacheForTests(): void {
  homeCache.clear();
}
