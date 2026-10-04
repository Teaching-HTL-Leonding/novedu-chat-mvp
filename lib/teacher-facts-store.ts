import { eq, type SQL, sql } from "drizzle-orm";
import {
  type CodeUsage,
  type TeacherCode,
  type TeacherFacts,
  windowStart,
} from "@/lib/achievements/teacher";
import { HOME_TIME_ZONE, SCHOOL_DAY_END, SCHOOL_DAY_START } from "@/lib/achievements/time";
import { CODE_MODULES, type CodeModule } from "@/lib/code-modules/types";
import { keyHoldersOfTeacherStatement } from "@/lib/coding-key-store";
import { getDb } from "@/lib/db";
import { codes } from "@/lib/db/schema";
import { listOpenReportCounts } from "@/lib/report-store";
import { reportStoreFailure } from "@/lib/store-failure";
import { chattersOfTeacherStatement } from "@/lib/user-chat-store";
import { writersOfTeacherStatement } from "@/lib/writing-store";

// The facts behind a teacher's start page (docs/home.md → Teacher dashboard).
// Every statement is keyed by the session user id and restricted to the codes
// that teacher created (`created_by`); each fact group is ONE statement and
// fails independently — a failed group comes back `undefined`, never as zeros.
// Never throws.
//
// Student counts read the frozen `anonymous` flag exactly like `getCodeStats`,
// and never name a student: only counts leave this module. Never reads the
// students' saved quiz results — they have no teacher reader at all.
//
// SERVER-ONLY: uses the database. Never import from client components.

const STORE = "teacher-facts-store";

const KNOWN_MODULES = new Set<string>(CODE_MODULES);

/** The teacher's codes — one scan of the `created_by` index. */
export async function listTeacherCodes(teacherId: string): Promise<TeacherCode[] | undefined> {
  try {
    const rows = await getDb()
      .select({
        code: codes.code,
        module: codes.module,
        note: codes.note,
        validFrom: codes.validFrom,
        validUntil: codes.validUntil,
        createdAt: codes.createdAt,
      })
      .from(codes)
      .where(eq(codes.createdBy, teacherId));
    // An unrecognized module is no activity for anyone (`checkCode` agrees).
    return rows
      .filter((row) => KNOWN_MODULES.has(row.module))
      .map((row) => ({ ...row, module: row.module as CodeModule }));
  } catch (error) {
    reportStoreFailure(STORE, "list codes", error);
    return undefined;
  }
}

// A counted interaction, as in the student facts: token-only buckets add nothing.
const INTERACTIONS = sql.raw(
  "(u.user_messages + u.quiz_answers + u.writing_saves + u.coding_requests)",
);

/**
 * The usage statement — exported so the `@live-db` test can EXPLAIN the real
 * one. Every code with at least one usage row ever, with the window's sums; a
 * bucket is outside school hours on a weekend or outside the local
 * `SCHOOL_DAY_START ≤ h < SCHOOL_DAY_END` (the same rule as `isSchoolHour`).
 */
export function usageStatement(teacherId: string, start: Date): SQL {
  const local = sql`(u.hour AT TIME ZONE ${HOME_TIME_ZONE})`;
  const outside = sql`(extract(isodow FROM ${local}) > 5
    OR extract(hour FROM ${local}) < ${SCHOOL_DAY_START}
    OR extract(hour FROM ${local}) >= ${SCHOOL_DAY_END})`;
  const inWindow = sql`u.hour >= ${start}`;
  return sql`
    SELECT u.code,
           coalesce(sum(${INTERACTIONS}) FILTER (WHERE ${inWindow}), 0) AS interactions,
           coalesce(sum(${INTERACTIONS}) FILTER (WHERE ${inWindow} AND ${outside}), 0)
             AS "outsideSchool",
           coalesce(sum(u.quiz_answers) FILTER (WHERE ${inWindow}), 0) AS "quizAnswers",
           coalesce(sum(u.input_tokens_new + u.input_tokens_cached) FILTER (WHERE ${inWindow}), 0)
             AS "inputTokens",
           coalesce(sum(u.output_tokens) FILTER (WHERE ${inWindow}), 0) AS "outputTokens"
    FROM novedu_codes c
    JOIN novedu_usage_by_code u ON u.code = c.code
    WHERE c.created_by = ${teacherId}
    GROUP BY u.code
  `;
}

/** The usage group: per code, PK range scans over the teacher's codes only. */
export async function loadTeacherUsage(
  teacherId: string,
  start: Date,
): Promise<CodeUsage[] | undefined> {
  try {
    const res = await getDb().execute<{
      code: string;
      interactions: number | string;
      outsideSchool: number | string;
      quizAnswers: number | string;
      inputTokens: number | string;
      outputTokens: number | string;
    }>(usageStatement(teacherId, start));
    return res.rows.map((row) => ({
      code: row.code,
      interactions: Number(row.interactions),
      outsideSchool: Number(row.outsideSchool),
      quizAnswers: Number(row.quizAnswers),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
    }));
  } catch (error) {
    reportStoreFailure(STORE, "load usage", error);
    return undefined;
  }
}

/**
 * The conversations statement: threads of the teacher's codes with a user
 * message in the window — the `EXISTS` shape of `getDashboardKpis`
 * (docs/dashboard.md), restricted by code. Exported for the `@live-db` test.
 */
export function conversationsStatement(teacherId: string, start: Date): SQL {
  return sql`
    SELECT count(*) AS conversations
    FROM novedu_codes c
    JOIN mastra.mastra_threads t ON t."resourceId" = c.code
    WHERE c.created_by = ${teacherId}
      AND EXISTS (
        SELECT 1 FROM mastra.mastra_messages m
        WHERE m.thread_id = t.id AND m.role = 'user' AND m."createdAtZ" >= ${start}
      )
  `;
}

export async function countTeacherConversations(
  teacherId: string,
  start: Date,
): Promise<number | undefined> {
  try {
    const res = await getDb().execute<{ conversations: number | string }>(
      conversationsStatement(teacherId, start),
    );
    return Number(res.rows[0]?.conversations ?? 0);
  } catch (error) {
    reportStoreFailure(STORE, "count conversations", error);
    return undefined;
  }
}

/**
 * The identified-students statement: distinct user ids across the per-user
 * chats and saved texts of the teacher's non-anonymous codes and the key holders
 * of their coding codes, all time, the teacher's own id excluded. Each subselect
 * comes from the store that owns its table. Exported for the `@live-db` test.
 */
export function studentsStatement(teacherId: string): SQL {
  return sql`
    SELECT count(DISTINCT s.user_id) AS students
    FROM (
      ${chattersOfTeacherStatement(teacherId)}
      UNION ALL
      ${writersOfTeacherStatement(teacherId)}
      UNION ALL
      ${keyHoldersOfTeacherStatement(teacherId)}
    ) s
    WHERE s.user_id <> ${teacherId}
  `;
}

export async function countIdentifiedStudents(teacherId: string): Promise<number | undefined> {
  try {
    const res = await getDb().execute<{ students: number | string }>(studentsStatement(teacherId));
    return Number(res.rows[0]?.students ?? 0);
  } catch (error) {
    reportStoreFailure(STORE, "count students", error);
    return undefined;
  }
}

/** Every teacher fact group, loaded in parallel (five statements). */
export async function loadTeacherFacts(teacherId: string, now: Date): Promise<TeacherFacts> {
  const start = windowStart(now);
  const [teacherCodes, usage, conversations, students, reports] = await Promise.all([
    listTeacherCodes(teacherId),
    loadTeacherUsage(teacherId, start),
    countTeacherConversations(teacherId, start),
    countIdentifiedStudents(teacherId),
    listOpenReportCounts(teacherId),
  ]);
  return { codes: teacherCodes, usage, conversations, students, reports };
}
