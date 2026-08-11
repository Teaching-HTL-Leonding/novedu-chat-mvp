import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { countRows } from "@/lib/db/count";
import { type PagedResult, type Paging, paginate } from "@/lib/db/paging";
import { codes, reports, users } from "@/lib/db/schema";
import { containsAny } from "@/lib/db/text-filter";
import type { QuizVerdict } from "@/lib/quiz-types";
import type { ReportKind, ReportReaction } from "@/lib/report-types";

// Persistence for student-submitted reports in the `novedu_reports` SQL table
// (GH issue #24) — a student flags exceptional behavior in a chat or a graded
// quiz answer, with a reaction and an optional description. The submit actions
// (lib/report-actions.ts) write here; the teacher inbox (`/reports`) reads +
// bulk-resolves through here; the code-delete path drops a code's reports inline
// in `deleteCodeRows` (lib/code-stats-store.ts) so the delete stays in the bulk
// transaction.
//
// The reporting student's oid is ALWAYS stored (even under an anonymous code) —
// the one sanctioned second user↔activity link (docs/reports.md, docs/codes.md).
// This store surfaces ONLY the reporter's own, voluntarily-waived identity: it
// LEFT-JOINs `novedu_users` for the reporter's display name and `novedu_codes`
// for the note/creator, but NEVER joins `novedu_user_chats` or any path that
// would reveal a DIFFERENT student behind a reported thread — the anonymity
// promise for everyone but the reporter stays intact.
//
// SERVER-ONLY: uses node:crypto and the database. Never import from client
// components. Reads never throw — `undefined` signals a database error.

/** A chat report to persist — proves thread ownership via the HMAC token upstream. */
export interface ChatReportInput {
  code: string;
  /** The reporting student's Entra `oid`. */
  userId: string;
  threadId: string;
  reaction: ReportReaction;
  description: string;
}

/** A quiz-answer report to persist — carries its own snapshot (grading persists nothing). */
export interface QuizReportInput {
  code: string;
  /** The reporting student's Entra `oid`. */
  userId: string;
  questionId: string;
  /** The SERVER's authoritative question text — never a client copy. */
  questionText: string;
  answerText: string;
  feedbackText: string;
  verdict: QuizVerdict;
  hadImages: boolean;
  reaction: ReportReaction;
  description: string;
}

/** One report as shown in the teacher inbox — the row plus its resolved joins. */
export interface ReportListRow {
  id: string;
  kind: ReportKind;
  code: string;
  /** The code's teacher note (LEFT JOIN `novedu_codes`), or `null` if the code is gone. */
  codeNote: string | null;
  /** The reporting student's Entra `oid`. */
  userId: string;
  /** The reporter's display name (LEFT JOIN `novedu_users`); the caller falls back to the oid. */
  displayName: string | null;
  reaction: ReportReaction;
  description: string;
  createdAt: Date;
  /** chat only. */
  threadId: string | null;
  /** quiz only (the snapshot the teacher reviews). */
  questionId: string | null;
  questionText: string | null;
  answerText: string | null;
  feedbackText: string | null;
  verdict: QuizVerdict | null;
  hadImages: boolean;
  /** Resolved ⇔ `resolvedAt !== null`; `resolvedBy` is the resolving teacher's oid. */
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

/** Inbox filter: which resolution states to show. */
export type ReportStatusFilter = "open" | "resolved" | "all";

/**
 * Inserts a chat report. Returns `false` (never throws) on a database error — the
 * submit action then surfaces a generic failure; without a stored row there is
 * nothing to review.
 */
export async function insertChatReport(input: ChatReportInput): Promise<boolean> {
  try {
    await getDb()
      .insert(reports)
      .values({
        id: randomUUID(),
        kind: "chat" satisfies ReportKind,
        code: input.code,
        userId: input.userId,
        reaction: input.reaction,
        description: input.description,
        createdAt: new Date(),
        threadId: input.threadId,
      });
    return true;
  } catch (error) {
    console.error("report-store: inserting a chat report failed", error);
    return false;
  }
}

/**
 * Inserts a quiz-answer report with its snapshot. Returns `false` (never throws)
 * on a database error. The photos are flagged (`hadImages`) but never stored.
 */
export async function insertQuizReport(input: QuizReportInput): Promise<boolean> {
  try {
    await getDb()
      .insert(reports)
      .values({
        id: randomUUID(),
        kind: "quiz-answer" satisfies ReportKind,
        code: input.code,
        userId: input.userId,
        reaction: input.reaction,
        description: input.description,
        createdAt: new Date(),
        questionId: input.questionId,
        questionText: input.questionText,
        answerText: input.answerText,
        feedbackText: input.feedbackText,
        verdict: input.verdict,
        hadImages: input.hadImages,
      });
    return true;
  } catch (error) {
    console.error("report-store: inserting a quiz report failed", error);
    return false;
  }
}

/**
 * How many chat reports this student already filed for this thread — the soft-cap
 * check. Returns `undefined` on a database error (the action then declines rather
 * than filing an unbounded row). Never throws.
 */
export async function countChatReports(
  threadId: string,
  userId: string,
): Promise<number | undefined> {
  try {
    const rows = await getDb()
      .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(reports)
      .where(
        and(eq(reports.kind, "chat"), eq(reports.threadId, threadId), eq(reports.userId, userId)),
      );
    return rows[0]?.n ?? 0;
  } catch (error) {
    console.error("report-store: counting chat reports failed", error);
    return undefined;
  }
}

/**
 * How many quiz reports this student already filed for this `(code, question)` —
 * the soft-cap check. Returns `undefined` on a database error. Never throws.
 */
export async function countQuizReports(
  code: string,
  userId: string,
  questionId: string,
): Promise<number | undefined> {
  try {
    const rows = await getDb()
      .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(reports)
      .where(
        and(
          eq(reports.kind, "quiz-answer"),
          eq(reports.code, code),
          eq(reports.userId, userId),
          eq(reports.questionId, questionId),
        ),
      );
    return rows[0]?.n ?? 0;
  } catch (error) {
    console.error("report-store: counting quiz reports failed", error);
    return undefined;
  }
}

/**
 * The reports for the teacher inbox, filtered IN THE DATABASE (docs/filtered-lists.md)
 * by resolution status, reaction, a free-text search, and — for the "only my codes"
 * toggle — the code's creating teacher. The reporter's display name comes from a
 * LEFT JOIN on `novedu_users` (BY VALUE, oid fallback is the caller's) and the code
 * note/creator from a LEFT JOIN on `novedu_codes`; a report whose code was deleted
 * still lists (both joins yield `null`). NEVER joins `novedu_user_chats` — the only
 * identity surfaced is the reporter's own (see the module header). Ordered so OPEN
 * `holysh` (urgent) reports float to the top, then newest first. Returns `undefined`
 * on a database error. Never throws.
 *
 * `paging` makes the SKIP and the LIMIT part of the SQL too (`OFFSET … FETCH`,
 * with a COUNT for the total); omitting it returns every match, which is what the
 * bearer API route wants.
 */
// The two reads that surface a report row — the list and `getReportById` — share
// their projection, their joins and their row mapper, so the three can never drift
// (and the "NEVER `novedu_user_chats`" invariant is stated in exactly one place).
// Both join keys are primary keys, so a LEFT JOIN can't multiply rows — which is
// also what keeps the list's `COUNT(*)` exact.
const JOIN_REPORTER = eq(users.userId, reports.userId);
const JOIN_CODE = eq(codes.code, reports.code);

const REPORT_ROW_SELECTION = {
  id: reports.id,
  kind: reports.kind,
  code: reports.code,
  codeNote: codes.note,
  userId: reports.userId,
  displayName: users.displayName,
  reaction: reports.reaction,
  description: reports.description,
  createdAt: reports.createdAt,
  threadId: reports.threadId,
  questionId: reports.questionId,
  questionText: reports.questionText,
  answerText: reports.answerText,
  feedbackText: reports.feedbackText,
  verdict: reports.verdict,
  hadImages: reports.hadImages,
  resolvedAt: reports.resolvedAt,
  resolvedBy: reports.resolvedBy,
};

// The columns are stored as plain strings; narrow them to the union types the
// callers rely on (an unknown value would already have failed validation on write).
type RawReportRow = Omit<ReportListRow, "kind" | "reaction" | "verdict"> & {
  kind: string;
  reaction: string;
  verdict: string | null;
};

function toListRow(row: RawReportRow): ReportListRow {
  return {
    ...row,
    kind: row.kind as ReportKind,
    reaction: row.reaction as ReportReaction,
    verdict: (row.verdict as QuizVerdict | null) ?? null,
  };
}

// The list's WHERE, built once and shared by the COUNT and the row query — they
// must never drift, or a page's total would describe a different set than its rows.
// The search and the "my codes" filter reach into the JOINED tables, which is why
// both queries carry the same two LEFT JOINs.
function listConditions(opts: {
  status: ReportStatusFilter;
  reaction?: ReportReaction;
  search?: string;
  codeCreatedBy?: string;
}): SQL[] {
  const conditions: SQL[] = [];
  if (opts.status === "open") conditions.push(isNull(reports.resolvedAt));
  else if (opts.status === "resolved") conditions.push(isNotNull(reports.resolvedAt));
  if (opts.reaction) conditions.push(eq(reports.reaction, opts.reaction));
  if (opts.codeCreatedBy) conditions.push(eq(codes.createdBy, opts.codeCreatedBy));
  const match = containsAny(opts.search ?? "", [
    reports.description,
    reports.userId,
    users.displayName,
    reports.code,
    codes.note,
  ]);
  if (match) conditions.push(match);
  return conditions;
}

export async function listReports(opts: {
  status: ReportStatusFilter;
  reaction?: ReportReaction;
  search?: string;
  codeCreatedBy?: string;
  paging?: Paging;
}): Promise<PagedResult<ReportListRow> | undefined> {
  const conditions = listConditions(opts);
  try {
    return await paginate({
      paging: opts.paging,
      count: () =>
        countRows(reports, conditions, [
          { table: users, on: JOIN_REPORTER },
          { table: codes, on: JOIN_CODE },
        ]),
      // A FRESH builder per call — drizzle builders are stateful and `paginate`
      // may invoke this twice (once more after clamping an over-shot page).
      rows: async (window) => {
        const query = getDb()
          .select(REPORT_ROW_SELECTION)
          .from(reports)
          .leftJoin(users, JOIN_REPORTER)
          .leftJoin(codes, JOIN_CODE)
          .where(and(...conditions))
          // Open `holysh` reports first (the urgent working set), then newest
          // first, then `id` — the leading CASE is far from unique, and
          // OFFSET/FETCH over a non-unique sort could repeat or skip a row.
          .orderBy(
            sql`CASE WHEN ${reports.reaction} = 'holysh' AND ${reports.resolvedAt} IS NULL THEN 0 ELSE 1 END`,
            desc(reports.createdAt),
            asc(reports.id),
          );
        const rows = await (window ? query.offset(window.offset).fetch(window.limit) : query);
        return rows.map(toListRow);
      },
    });
  } catch (error) {
    console.error("report-store: listing reports failed", error);
    return undefined;
  }
}

/**
 * A single report by id — the single-row twin of `listReports`, with the SAME
 * LEFT JOINs (`novedu_users` for the reporter's display name, `novedu_codes` for
 * the note, both BY VALUE) and, like every read here, NEVER a `novedu_user_chats`
 * join (the only identity surfaced is the reporter's own). Backs the bearer-channel
 * report detail (`GET /api/reports/<id>`, docs/api.md). Returns `null` when no
 * report has that id, `undefined` on a database error. Never throws.
 */
export async function getReportById(id: string): Promise<ReportListRow | null | undefined> {
  try {
    const rows = await getDb()
      .select(REPORT_ROW_SELECTION)
      .from(reports)
      .leftJoin(users, JOIN_REPORTER)
      .leftJoin(codes, JOIN_CODE)
      .where(eq(reports.id, id));
    const row = rows[0];
    if (!row) return null;
    return toListRow(row);
  } catch (error) {
    console.error("report-store: loading a report failed", error);
    return undefined;
  }
}

/**
 * Bulk-sets the resolution state of the given reports. `resolved: true` stamps
 * `resolvedAt = now` + `resolvedBy = teacherId`; `resolved: false` (reopen) nulls
 * BOTH columns — `resolvedAt` is the single source of truth for resolution.
 * Returns `false` (never throws) on a database error. A no-op for an empty id list.
 */
export async function setReportsResolved(
  ids: string[],
  resolved: boolean,
  teacherId: string,
): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    await getDb()
      .update(reports)
      .set(
        resolved
          ? { resolvedAt: new Date(), resolvedBy: teacherId }
          : { resolvedAt: null, resolvedBy: null },
      )
      .where(inArray(reports.id, ids));
    return true;
  } catch (error) {
    console.error("report-store: updating report resolution failed", error);
    return false;
  }
}

/**
 * Bulk-deletes the given reports (the inbox's "Delete Selected", the only way to
 * delete a report). Returns `false` (never throws) on a database error. A no-op
 * for an empty id list.
 */
export async function deleteReports(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    await getDb().delete(reports).where(inArray(reports.id, ids));
    return true;
  } catch (error) {
    console.error("report-store: deleting reports failed", error);
    return false;
  }
}
