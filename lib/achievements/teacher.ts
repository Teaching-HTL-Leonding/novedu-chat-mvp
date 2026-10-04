// The teacher start page's rules (docs/home.md → Teacher dashboard): the
// attention counters, the KPIs and the top activities, derived from the facts
// about the teacher's OWN codes. Pure — no database, no clock of its own.

import type { CodeModule } from "@/lib/code-modules/types";
import { addDays, startOfLocalDay, todayLocal } from "./time";

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
 * One code's usage (`novedu_usage_by_code`). Every code with at least one usage
 * row EVER is present (with zero sums when none falls in the window); a code
 * that was never used is absent.
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

/** The teacher's fact groups: each one statement, failing independently. */
export const TEACHER_FACT_GROUPS = [
  "codes",
  "usage",
  "conversations",
  "students",
  "reports",
] as const;

/**
 * Every teacher fact group. Each is one statement and fails independently: an
 * `undefined` group is unavailable, never read as zero or empty.
 */
export interface TeacherFacts {
  codes?: TeacherCode[];
  usage?: CodeUsage[];
  /** Threads of the teacher's codes with a user message in the window. */
  conversations?: number;
  /** Distinct identified students over all time, the teacher excluded. */
  students?: number;
  reports?: OpenReports[];
}

/** The first instant of the window (local midnight, 29 days before today). */
export function windowStart(now: Date): Date {
  return startOfLocalDay(addDays(todayLocal(now), -(WINDOW_DAYS - 1)));
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
