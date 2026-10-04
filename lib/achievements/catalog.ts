// The achievement catalog (docs/home.md). Every rule is a pure, lifetime
// predicate over the user's facts: it either names the Vienna-local date on
// which its evidence was first complete, or reports progress. A stored grant
// stays earned whatever the current facts say.
//
// SERVER-ONLY: hidden achievements' names and criteria must never reach a client
// bundle — import this only from server modules (guard-tested in
// catalog.unit.test.ts). The page receives plain data built by lib/home-data.ts.

import {
  streakReached,
  totalReaching,
  type UsageDay,
  activeDays as usageActiveDays,
  weekDaysReached,
} from "./derive";
import type { LocalDate } from "./time";

/** A fact group: loaded by one statement, failing independently of the others. */
export type FactGroup = "usage";

/** A student's facts; a group is `undefined` when its load failed (never read as zero). */
export interface StudentFacts {
  usage: UsageDay[] | undefined;
}

/** Keys into the page's badge icon set (app/_home/badge-icon.tsx). */
export type BadgeIcon = "flame" | "calendar" | "check" | "pen";

export type Outcome =
  | { earned: true; qualifiedOn: LocalDate }
  | { earned: false; current: number; target: number };

export interface Achievement<F> {
  /** Stable and stored. Never contains a code; a tier ladder is `<ladder>-<n>`. */
  id: string;
  audience: "student" | "teacher";
  /** Grouping on the page; see FAMILIES. */
  family: string;
  /** Position within the family. */
  order: number;
  icon: BadgeIcon;
  name: string;
  /** One line, shown for listed achievements. */
  criterion: string;
  /** Not listed until earned (students only). */
  hidden: boolean;
  xp: number;
  /** The fact groups the rule reads; evaluated only when all are available. */
  needs: readonly FactGroup[];
  evaluate(facts: F): Outcome;
}

export type StudentAchievement = Achievement<StudentFacts>;

/** The student families, in page order. */
export const STUDENT_FAMILIES = [
  { id: "rhythm", label: "Rhythm" },
  { id: "practice", label: "Practice" },
] as const;

/** Reads a group the evaluator has already checked; reaching it unavailable is a bug. */
function need<T>(group: T | undefined, name: FactGroup): T {
  if (group === undefined)
    throw new Error(`achievement rule read the unavailable fact group "${name}"`);
  return group;
}

// Derived usage facts are computed once per usage array, not once per rule.
interface UsageStats {
  streaks: LocalDate[];
  weekDays: LocalDate[];
  activeDates: LocalDate[];
}
const statsCache = new WeakMap<UsageDay[], UsageStats>();
function usageStats(usage: UsageDay[]): UsageStats {
  let stats = statsCache.get(usage);
  if (!stats) {
    stats = {
      streaks: streakReached(usage),
      weekDays: weekDaysReached(usage),
      activeDates: usageActiveDays(usage).map((d) => d.date),
    };
    statsCache.set(usage, stats);
  }
  return stats;
}

/** A tier earned when the k-th milestone of a "first reached" list exists. */
function milestone(reached: LocalDate[], target: number): Outcome {
  const qualifiedOn = reached[target - 1];
  return qualifiedOn !== undefined
    ? { earned: true, qualifiedOn }
    : { earned: false, current: reached.length, target };
}

function counter(usage: UsageDay[], value: (d: UsageDay) => number, target: number): Outcome {
  const { total, reachedOn } = totalReaching(usage, value, target);
  return reachedOn !== undefined
    ? { earned: true, qualifiedOn: reachedOn }
    : { earned: false, current: total, target };
}

interface Tier {
  n: number;
  name: string;
  xp: number;
}

function ladder(
  base: Omit<StudentAchievement, "id" | "order" | "name" | "criterion" | "xp" | "evaluate">,
  ladderId: string,
  firstOrder: number,
  tiers: Tier[],
  criterion: (n: number) => string,
  rule: (usage: UsageDay[], n: number) => Outcome,
): StudentAchievement[] {
  return tiers.map((tier, i) => ({
    ...base,
    id: `${ladderId}-${tier.n}`,
    order: firstOrder + i,
    name: tier.name,
    criterion: criterion(tier.n),
    xp: tier.xp,
    evaluate: (facts) => rule(need(facts.usage, "usage"), tier.n),
  }));
}

const rhythm = { audience: "student", family: "rhythm", hidden: false, needs: ["usage"] } as const;
const practice = {
  audience: "student",
  family: "practice",
  hidden: false,
  needs: ["usage"],
} as const;

/** Every student achievement, in page order. */
export const STUDENT_CATALOG: readonly StudentAchievement[] = [
  ...ladder(
    { ...rhythm, icon: "flame" },
    "weekly-streak",
    0,
    [
      { n: 2, name: "Two in a Row", xp: 20 },
      { n: 4, name: "Four Weeks Strong", xp: 50 },
      { n: 8, name: "Eight-Week Run", xp: 100 },
      { n: 16, name: "A Whole Season", xp: 200 },
    ],
    (n) => `Active ${n} weeks in a row`,
    (usage, n) => milestone(usageStats(usage).streaks, n),
  ),
  ...ladder(
    { ...rhythm, icon: "calendar" },
    "week-days",
    10,
    [
      { n: 3, name: "Three-Day Week", xp: 20 },
      { n: 5, name: "Five-Day Week", xp: 50 },
    ],
    (n) => `Active on ${n} days of one week`,
    (usage, n) => milestone(usageStats(usage).weekDays, n),
  ),
  ...ladder(
    { ...rhythm, icon: "calendar" },
    "active-days",
    20,
    [
      { n: 10, name: "Ten Days In", xp: 20 },
      { n: 30, name: "Thirty Days In", xp: 50 },
      { n: 100, name: "A Hundred Days", xp: 100 },
    ],
    (n) => `${n} active days`,
    (usage, n) => milestone(usageStats(usage).activeDates, n),
  ),
  ...ladder(
    { ...practice, icon: "check" },
    "quiz-answers",
    0,
    [
      { n: 10, name: "First Ten Answers", xp: 20 },
      { n: 100, name: "A Hundred Answers", xp: 50 },
      { n: 500, name: "Answer Machine", xp: 100 },
    ],
    (n) => `Submit ${n} quiz answers`,
    (usage, n) => counter(usage, (d) => d.quizAnswers, n),
  ),
  ...ladder(
    { ...practice, icon: "pen" },
    "writing-saves",
    10,
    [
      { n: 5, name: "First Drafts", xp: 20 },
      { n: 25, name: "Rewriter", xp: 50 },
      { n: 100, name: "Hundred Saves", xp: 100 },
    ],
    (n) => `Save your writing ${n} times`,
    (usage, n) => counter(usage, (d) => d.writingSaves, n),
  ),
];

/** The ladder an id belongs to (`weekly-streak-4` → `weekly-streak`); a one-off is its own ladder. */
export function ladderOf(id: string): string {
  return id.replace(/-\d+$/, "");
}
