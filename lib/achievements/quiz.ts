// Derived facts over a student's SAVED quiz results (docs/home.md → Saving a
// quiz result): scores, medals, the per-quiz best and last attempt, the "Time
// to refresh" nudges and the dates the Quiz-mastery rules read. Pure — the rows
// come from lib/quiz-result-store.ts, `today` from the caller.
//
// Scores are compared as exact fractions, never as rounded percentages: a score
// is `(2 × correct + partial) / (2 × total)`, and two scores are compared by
// cross-multiplying in BigInt, so no attempt length can overflow or round.

import { dayDistance, type LocalDate } from "./time";

/** Per `(user, code)` the store keeps this many newest attempts (plus the best one). */
export const RETAINED_NEWEST = 50;

/** One saved attempt, with its code's note and window as of the load. */
export interface QuizAttempt {
  /** The attempt's uuid. */
  id: string;
  code: string;
  correct: number;
  partial: number;
  incorrect: number;
  unanswered: number;
  /** The full attempt length (the sum of the four counts). */
  total: number;
  /** Server time of the save; "newest" orders by `(finishedAt, id)` descending. */
  finishedAt: Date;
  /** The Vienna-local date of `finishedAt`. */
  finishedOn: LocalDate;
  /** The code's note ("" when it has none). */
  note: string;
  /** Whether the code exists with an open validity window. */
  open: boolean;
}

export type Medal = "gold" | "silver" | "bronze";

// BigInt via calls, not literals: the TypeScript target predates `2n`.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const FIVE = BigInt(5);
const EIGHT = BigInt(8);

/** `2 × correct + partial`: the score's numerator over `2 × total`. */
function points(a: QuizAttempt): bigint {
  return TWO * BigInt(a.correct) + BigInt(a.partial);
}

/** Sign of `score(a) − score(b)`, exact. */
export function compareScore(a: QuizAttempt, b: QuizAttempt): number {
  const diff = points(a) * BigInt(b.total) - points(b) * BigInt(a.total);
  return diff > ZERO ? 1 : diff < ZERO ? -1 : 0;
}

/** Chronological order: `finishedAt`, then `id`. */
export function compareFinished(a: QuizAttempt, b: QuizAttempt): number {
  return (
    a.finishedAt.getTime() - b.finishedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The score in whole percent, rounded DOWN: a display value only (never
 * compared), and rounding down never shows 100 % for an attempt short of gold.
 */
export function scorePercent(a: QuizAttempt): number {
  return a.total > 0 ? Math.floor((100 * Number(points(a))) / (2 * a.total)) : 0;
}

/** Gold = every slot correct; silver ≥ 80 %; bronze ≥ 50 %; else none. */
export function medalOf(a: QuizAttempt): Medal | undefined {
  const p = points(a);
  const total = BigInt(a.total);
  if (a.total > 0 && a.correct === a.total) return "gold";
  // p / 2t ≥ 0.8 ⇔ 5p ≥ 8t;  p / 2t ≥ 0.5 ⇔ p ≥ t.
  if (FIVE * p >= EIGHT * total) return "silver";
  if (p >= total) return "bronze";
  return undefined;
}

/** One quiz (code) with its saved attempts. */
export interface QuizSummary {
  code: string;
  note: string;
  open: boolean;
  /** Chronological. */
  attempts: QuizAttempt[];
  last: QuizAttempt;
  /** The highest score; ties go to the newest attempt (the store's prune keeps the same one). */
  best: QuizAttempt;
  medal: Medal | undefined;
}

/** The attempts grouped by code, each chronological; quizzes ordered by code. */
export function quizSummaries(attempts: readonly QuizAttempt[]): QuizSummary[] {
  const byCode = new Map<string, QuizAttempt[]>();
  for (const attempt of attempts) {
    const list = byCode.get(attempt.code);
    if (list) list.push(attempt);
    else byCode.set(attempt.code, [attempt]);
  }
  return [...byCode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, list]) => {
      const sorted = [...list].sort(compareFinished);
      const last = sorted[sorted.length - 1] as QuizAttempt;
      let best = last;
      for (const attempt of sorted) {
        // `>=` while walking forward hands ties to the newer attempt.
        if (compareScore(attempt, best) >= 0) best = attempt;
      }
      return {
        code,
        note: last.note,
        open: last.open,
        attempts: sorted,
        last,
        best,
        medal: medalOf(best),
      };
    });
}

/** How many nudges "Time to refresh" shows at most. */
export const NUDGES_MAX = 3;

/**
 * "Time to refresh": a quiz whose last attempt is ≥ 5 days old AND (below gold
 * OR > 14 days old) AND whose code is open — oldest last attempt first, ties by
 * code, at most three.
 */
export function refreshNudges(quizzes: readonly QuizSummary[], today: LocalDate): QuizSummary[] {
  return quizzes
    .filter((q) => {
      const age = dayDistance(q.last.finishedOn, today);
      return q.open && age >= 5 && (q.medal !== "gold" || age > 14);
    })
    .sort(
      (a, b) =>
        a.last.finishedAt.getTime() - b.last.finishedAt.getTime() ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    )
    .slice(0, NUDGES_MAX);
}

/** Quizzes per medal (from each quiz's best attempt). */
export function medalCounts(quizzes: readonly QuizSummary[]): Record<Medal, number> {
  const counts = { gold: 0, silver: 0, bronze: 0 };
  for (const q of quizzes) if (q.medal) counts[q.medal]++;
  return counts;
}

/** The earliest of some dates, or undefined. */
function earliest(dates: (LocalDate | undefined)[]): LocalDate | undefined {
  let first: LocalDate | undefined;
  for (const date of dates)
    if (date !== undefined && (first === undefined || date < first)) first = date;
  return first;
}

/** The days the saved results were first complete: entry 0 is the first saved result. */
export function resultsReached(attempts: readonly QuizAttempt[]): LocalDate[] {
  return [...attempts].sort(compareFinished).map((a) => a.finishedOn);
}

/**
 * Gold milestones: entry `k − 1` is the date the k-th distinct quiz got its
 * first gold.
 */
export function goldsReached(quizzes: readonly QuizSummary[]): LocalDate[] {
  return quizzes
    .flatMap((q) => q.attempts.find((a) => medalOf(a) === "gold")?.finishedOn ?? [])
    .sort();
}

/**
 * Improved: the first attempt whose score beats the best of ALL earlier saved
 * attempts of the same quiz.
 */
export function improvedOn(quizzes: readonly QuizSummary[]): LocalDate | undefined {
  return earliest(
    quizzes.map((q) => {
      // Until some attempt beats it, the first attempt IS the best of the earlier ones.
      const [first, ...later] = q.attempts;
      if (!first) return undefined;
      return later.find((attempt) => compareScore(attempt, first) > 0)?.finishedOn;
    }),
  );
}

/**
 * Refreshed: two consecutive saved attempts of one quiz ≥ 5 days apart (day
 * distance), dated to the later one. "Consecutive" is evaluated inside the
 * newest-50 run, which retention keeps contiguous — the extra best row the store
 * keeps beyond it is never paired across the gap.
 */
export function refreshedOn(quizzes: readonly QuizSummary[]): LocalDate | undefined {
  return earliest(
    quizzes.map((q) => {
      const run = q.attempts.slice(-RETAINED_NEWEST);
      for (let i = 1; i < run.length; i++) {
        const before = run[i - 1] as QuizAttempt;
        const after = run[i] as QuizAttempt;
        if (dayDistance(before.finishedOn, after.finishedOn) >= 5) return after.finishedOn;
      }
      return undefined;
    }),
  );
}
