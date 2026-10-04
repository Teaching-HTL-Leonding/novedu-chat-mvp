// The teacher start page's rules (docs/home.md → Teacher dashboard): the
// attention counters, the KPIs, the top activities and the lifetime facts behind
// the teacher's badges, derived from the facts about the teacher's OWN codes.
// Pure — no database, no clock of its own.

import { CODE_MODULES, type CodeModule } from "@/lib/code-modules/types";
import {
  addDays,
  isoWeekKey,
  type LocalDate,
  localDateOf,
  startOfLocalDay,
  todayLocal,
} from "./time";

/** The dashboard's window: the last 30 Vienna-local days, today included. */
export const WINDOW_DAYS = 30;
/** "Closing soon": the window ends within this many days from now. */
export const CLOSING_SOON_DAYS = 3;
/** "Never used": created more than this many days ago. */
export const NEVER_USED_AFTER_DAYS = 7;
/** How many codes a counter lists, and how many activities the board ranks. */
export const LIST_MAX = 5;

const DAY_MS = 86_400_000;

/** One of the teacher's codes (`novedu_codes`, `created_by` = the teacher). */
export interface TeacherCode {
  code: string;
  module: CodeModule;
  note: string;
  validFrom: Date | null;
  validUntil: Date | null;
  createdAt: Date;
}

/**
 * One code's usage on one Vienna-local day (`novedu_usage_by_code`, the whole
 * history). Every code with at least one usage row EVER has at least one day; a
 * code that was never used has none.
 */
export interface CodeDay {
  code: string;
  date: LocalDate;
  /** Messages + quiz answers + writing saves + coding requests. */
  interactions: number;
  /** The part of `interactions` in buckets outside school hours. */
  outsideSchool: number;
  quizAnswers: number;
  /** New + cached input tokens. */
  inputTokens: number;
  outputTokens: number;
}

/**
 * One code's sums over the window. Every code with at least one usage row EVER
 * is present (with zero sums when none falls in the window); a code that was
 * never used is absent.
 */
export interface CodeUsage {
  code: string;
  /** Messages + quiz answers + writing saves + coding requests in the window. */
  interactions: number;
  /** The part of `interactions` in buckets outside school hours. */
  outsideSchool: number;
  quizAnswers: number;
  /** New + cached input tokens in the window. */
  inputTokens: number;
  outputTokens: number;
}

/** Open (unresolved) reports on one of the teacher's codes. */
export interface OpenReports {
  code: string;
  open: number;
}

/** The reports group: open reports per own code, and the reports the teacher resolved. */
export interface TeacherReports {
  open: OpenReports[];
  /** Reports resolved by the teacher (`resolved_by`), on any code. */
  resolved: number;
  /** The local dates of the first `LISTENER_REPORTS` of them, ascending. */
  resolvedOn: LocalDate[];
}

/** Identified students on one of the teacher's codes (the teacher excluded). */
export interface CodeStudents {
  code: string;
  count: number;
  /** The local dates each student was first seen on the code, ascending — the first `CROWD_MAX`. */
  firstSeen: LocalDate[];
}

/** The students group: distinct identified students overall, and per code. */
export interface IdentifiedStudents {
  total: number;
  perCode: CodeStudents[];
}

/** The files group: the teacher's own versions of the YAML files they wrote. */
export interface FileVersions {
  /** The most versions of one file name the teacher wrote. */
  most: number;
  /** The local date some file name first reached `ITERATOR_VERSIONS` of them. */
  reachedOn?: LocalDate;
}

// The badges' thresholds (docs/home.md → Teacher achievements). The catalog's
// rules read them, and the stores cap their lists by them.

/** Crowd: the top tier of identified students on one activity. */
export const CROWD_MAX = 100;
/** Evergreen: one activity used in this many different ISO weeks. */
export const EVERGREEN_WEEKS = 8;
/** Iterator: versions of one file. */
export const ITERATOR_VERSIONS = 5;
/** Listener: reports resolved. */
export const LISTENER_REPORTS = 10;
/** Homework Hit: at least this many interactions on the activity … */
export const HOMEWORK_MIN = 50;

/** The teacher's fact groups: each one statement, failing independently. */
export const TEACHER_FACT_GROUPS = [
  "codes",
  "usage",
  "conversations",
  "students",
  "reports",
  "files",
] as const;
export type TeacherFactGroup = (typeof TEACHER_FACT_GROUPS)[number];

/**
 * Every teacher fact group. Each is one statement and fails independently: an
 * `undefined` group is unavailable, never read as zero or empty.
 */
export interface TeacherFacts {
  codes?: TeacherCode[];
  /** Per code and local day, the whole history. */
  usage?: CodeDay[];
  /** Threads of the teacher's codes with a user message in the window. */
  conversations?: number;
  /** All time, the teacher excluded. */
  students?: IdentifiedStudents;
  reports?: TeacherReports;
  files?: FileVersions;
}

/** The groups of `facts` that loaded. */
export function availableTeacherGroups(facts: TeacherFacts): Set<TeacherFactGroup> {
  return new Set(TEACHER_FACT_GROUPS.filter((group) => facts[group] !== undefined));
}

/** The first instant of the window (local midnight, 29 days before today). */
export function windowStart(now: Date): Date {
  return startOfLocalDay(addDays(todayLocal(now), -(WINDOW_DAYS - 1)));
}

/**
 * Each code's sums over the window (the days from `windowStart`'s local date on).
 * A code with usage only before the window is present with zeros.
 */
export function codeUsage(days: readonly CodeDay[], now: Date): CodeUsage[] {
  const first = localDateOf(windowStart(now));
  const byCode = new Map<string, CodeUsage>();
  for (const day of days) {
    let sums = byCode.get(day.code);
    if (!sums) {
      sums = {
        code: day.code,
        interactions: 0,
        outsideSchool: 0,
        quizAnswers: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      byCode.set(day.code, sums);
    }
    if (day.date < first) continue;
    sums.interactions += day.interactions;
    sums.outsideSchool += day.outsideSchool;
    sums.quizAnswers += day.quizAnswers;
    sums.inputTokens += day.inputTokens;
    sums.outputTokens += day.outputTokens;
  }
  return [...byCode.values()];
}

/** Whether students can open the code right now (the `checkCode()` window rule). */
export function windowOpen(code: TeacherCode, now: Date): boolean {
  return (
    (code.validFrom === null || code.validFrom <= now) &&
    (code.validUntil === null || code.validUntil >= now)
  );
}

/** Open now and closing within `CLOSING_SOON_DAYS`, soonest first, ties by code. */
export function closingSoon(codes: readonly TeacherCode[], now: Date): TeacherCode[] {
  const limit = now.getTime() + CLOSING_SOON_DAYS * DAY_MS;
  return codes
    .filter((c) => windowOpen(c, now) && c.validUntil !== null && c.validUntil.getTime() <= limit)
    .sort(
      (a, b) =>
        (a.validUntil?.getTime() ?? 0) - (b.validUntil?.getTime() ?? 0) ||
        a.code.localeCompare(b.code),
    );
}

/**
 * Created more than `NEVER_USED_AFTER_DAYS` ago, open now (a code students cannot
 * open yet is not worth a nudge), and without a single usage row. Oldest first.
 */
export function neverUsed(
  codes: readonly TeacherCode[],
  usage: readonly CodeUsage[],
  now: Date,
): TeacherCode[] {
  const used = new Set(usage.map((u) => u.code));
  const before = now.getTime() - NEVER_USED_AFTER_DAYS * DAY_MS;
  return codes
    .filter((c) => c.createdAt.getTime() < before && windowOpen(c, now) && !used.has(c.code))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.code.localeCompare(b.code));
}

/** Codes with open reports, most open first, ties by code. */
export function reportedCodes(reports: readonly OpenReports[]): OpenReports[] {
  return reports
    .filter((r) => r.open > 0)
    .sort((a, b) => b.open - a.open || a.code.localeCompare(b.code));
}

/** The busiest codes in the window, most interactions first, ties by code. */
export function topActivities(usage: readonly CodeUsage[]): CodeUsage[] {
  return usage
    .filter((u) => u.interactions > 0)
    .sort((a, b) => b.interactions - a.interactions || a.code.localeCompare(b.code))
    .slice(0, LIST_MAX);
}

/** Whole percent of a code's interactions outside school hours, rounded. */
export function outsideSchoolPercent(usage: CodeUsage): number {
  return usage.interactions === 0
    ? 0
    : Math.round((usage.outsideSchool / usage.interactions) * 100);
}

/** The window's sums over every code. */
export function usageTotals(usage: readonly CodeUsage[]): {
  quizAnswers: number;
  inputTokens: number;
  outputTokens: number;
} {
  return usage.reduce(
    (sum, u) => ({
      quizAnswers: sum.quizAnswers + u.quizAnswers,
      inputTokens: sum.inputTokens + u.inputTokens,
      outputTokens: sum.outputTokens + u.outputTokens,
    }),
    { quizAnswers: 0, inputTokens: 0, outputTokens: 0 },
  );
}

// ---------------------------------------------------------------------------
// Lifetime facts behind the teacher's badges. Each names the local date its
// evidence was first complete (`reachedOn`), or the best progress so far.

export interface Reach {
  reachedOn?: LocalDate;
  /** The best value on any one activity (or overall) so far. */
  best: number;
}

/** The local dates on which the 1st, 2nd, … distinct module was first shared, ascending. */
export function kindsReached(codes: readonly TeacherCode[]): LocalDate[] {
  const first = new Map<CodeModule, LocalDate>();
  for (const code of codes) {
    const on = localDateOf(code.createdAt);
    const seen = first.get(code.module);
    if (seen === undefined || on < seen) first.set(code.module, on);
  }
  return [...first.values()].sort();
}

/** How many module kinds exist — Full Toolkit shares every one of them. */
export const KIND_COUNT = CODE_MODULES.length;

/** The earliest reach over all codes, and the best progress. */
function earliest(reaches: Iterable<Reach>): Reach {
  let best = 0;
  let reachedOn: LocalDate | undefined;
  for (const reach of reaches) {
    best = Math.max(best, reach.best);
    if (reach.reachedOn !== undefined && (reachedOn === undefined || reach.reachedOn < reachedOn)) {
      reachedOn = reach.reachedOn;
    }
  }
  return reachedOn === undefined ? { best } : { reachedOn, best };
}

/** One code's days, ascending. */
function daysByCode(days: readonly CodeDay[]): CodeDay[][] {
  const byCode = new Map<string, CodeDay[]>();
  for (const day of days) {
    const list = byCode.get(day.code);
    if (list) list.push(day);
    else byCode.set(day.code, [day]);
  }
  return [...byCode.values()].map((list) => list.sort((a, b) => a.date.localeCompare(b.date)));
}

/** Crowd: the first day some activity had `n` identified students. */
export function crowdReached(students: IdentifiedStudents, n: number): Reach {
  return earliest(
    students.perCode.map((code) => {
      const reachedOn = code.count >= n ? code.firstSeen[n - 1] : undefined;
      return reachedOn === undefined ? { best: code.count } : { reachedOn, best: code.count };
    }),
  );
}

/** Busy: the first day some activity's running total of interactions reached `n`. */
export function busyReached(days: readonly CodeDay[], n: number): Reach {
  return earliest(
    daysByCode(days).map((list) => {
      let total = 0;
      for (const day of list) {
        total += day.interactions;
        if (total >= n) return { reachedOn: day.date, best: n };
      }
      return { best: total };
    }),
  );
}

/** Evergreen: the first day some activity was used in its `n`-th different ISO week. */
export function weeksReached(days: readonly CodeDay[], n: number): Reach {
  return earliest(
    daysByCode(days).map((list) => {
      const weeks = new Set<LocalDate>();
      for (const day of list) {
        if (day.interactions === 0) continue;
        weeks.add(isoWeekKey(day.date));
        if (weeks.size >= n) return { reachedOn: day.date, best: n };
      }
      return { best: weeks.size };
    }),
  );
}

/**
 * Homework Hit: the first day on which some activity had at least `HOMEWORK_MIN`
 * interactions in total, at least half of them outside school hours (running
 * totals from the activity's first day). No honest count measures the way
 * there, so `best` is 0 until it is reached.
 */
export function homeworkReached(days: readonly CodeDay[]): Reach {
  return earliest(
    daysByCode(days).map((list) => {
      let total = 0;
      let outside = 0;
      for (const day of list) {
        total += day.interactions;
        outside += day.outsideSchool;
        if (total >= HOMEWORK_MIN && 2 * outside >= total) return { reachedOn: day.date, best: 1 };
      }
      return { best: 0 };
    }),
  );
}
