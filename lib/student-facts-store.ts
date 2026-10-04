import { type SQL, sql } from "drizzle-orm";
import type { StudentFacts } from "@/lib/achievements/catalog";
import type { UsageDay } from "@/lib/achievements/derive";
import { HOME_TIME_ZONE } from "@/lib/achievements/time";
import { getDb } from "@/lib/db";
import { reportStoreFailure } from "@/lib/store-failure";

// The facts behind a student's start page (docs/home.md → Facts queries). Every
// statement is keyed by the session user id and reads only that user's rows;
// each fact group is ONE statement and fails independently — a failed group
// comes back `undefined`, never as zeros. Never throws.
//
// Never reads `novedu_user_chats`, `novedu_recent_codes` or another user's rows.
//
// SERVER-ONLY: uses the database. Never import from client components.

const STORE = "student-facts-store";

/** The usage statement — exported so the `@live-db` test can EXPLAIN the real one. */
export function usageStatement(userId: string): SQL {
  return sql`
    SELECT ((u.hour AT TIME ZONE ${HOME_TIME_ZONE})::date)::text AS day,
           count(*) FILTER (WHERE u.user_messages + u.quiz_answers + u.writing_saves > 0) AS "activeHours",
           sum(u.quiz_answers) AS "quizAnswers",
           sum(u.writing_saves) AS "writingSaves"
    FROM novedu_usage_by_user u
    WHERE u.user_id = ${userId}
    GROUP BY 1
    HAVING count(*) FILTER (WHERE u.user_messages + u.quiz_answers + u.writing_saves > 0) > 0
    ORDER BY 1
  `;
}

/**
 * The usage group: `novedu_usage_by_user` grouped by Vienna-local day over the
 * whole history — one PK range scan over the user's rows. An active hour is a
 * UTC-hour bucket with any counted interaction (token-only buckets don't
 * count); the two buckets sharing local 02:00 on the autumn clock change are
 * two hours.
 */
export async function loadStudentUsage(userId: string): Promise<UsageDay[] | undefined> {
  try {
    const res = await getDb().execute<{
      day: string;
      activeHours: number | string;
      quizAnswers: number | string;
      writingSaves: number | string;
    }>(usageStatement(userId));
    return res.rows.map((row) => ({
      date: row.day,
      activeHours: Number(row.activeHours),
      quizAnswers: Number(row.quizAnswers),
      writingSaves: Number(row.writingSaves),
    }));
  } catch (error) {
    reportStoreFailure(STORE, "load usage", error);
    return undefined;
  }
}

/** Every student fact group, loaded in parallel. */
export async function loadStudentFacts(userId: string): Promise<StudentFacts> {
  const [usage] = await Promise.all([loadStudentUsage(userId)]);
  return { usage };
}
