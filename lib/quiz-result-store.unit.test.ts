import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The saved-results store (lib/quiz-result-store.ts) and the settings store it
// locks through (lib/user-settings-store.ts), plus the reports fact group
// (lib/report-store.ts) and the student facts loader (lib/student-facts-store.ts).
// A recording fake stands in for Drizzle: every statement
// lands in `log` in order, so the tests assert the transaction's SHAPE — the
// advisory lock, the code row FOR SHARE, the setting, insert, prune — and that a
// failure never passes the raw error on. The real statements' behaviour
// (locks, prune, races) is the `@live-db` suite's job (e2e/quiz-results.live.spec.ts).

const fake = vi.hoisted(() => {
  const state = {
    log: [] as string[],
    /** Rows a select returns, by table name. */
    rows: {} as Record<string, unknown[]>,
    executeRows: [] as unknown[],
    executed: [] as unknown[],
    values: [] as unknown[],
    /** Every `.where()` predicate, in call order (rendered by the tests). */
    wheres: [] as unknown[],
    /** A log entry prefix that fails (e.g. "insert novedu_quiz_results"). */
    failOn: undefined as string | undefined,
    error: undefined as unknown,
  };
  return { state };
});

const recordError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => {
  const { state } = fake;
  const step = <T>(entry: string, value: T): Promise<T> => {
    state.log.push(entry);
    return state.failOn !== undefined && entry.startsWith(state.failOn)
      ? Promise.reject(state.error)
      : Promise.resolve(value);
  };
  // A builder is awaitable where Drizzle's is; the step runs (and is logged) only
  // when awaited, so a chain continued past it logs just its final shape.
  const lazy = <T>(entry: string, value: () => T) => ({
    // biome-ignore lint/suspicious/noThenProperty: mimics Drizzle's thenable query builders.
    then: (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) =>
      step(entry, value()).then(resolve, reject),
  });
  const name = (table: Table) => getTableName(table);
  const selectChain = (table: Table) => {
    const rows = () => state.rows[name(table)] ?? [];
    const where = (predicate: unknown) => {
      state.wheres.push(predicate);
      return {
        ...lazy(`select ${name(table)}`, rows),
        for: (strength: string) => lazy(`select ${name(table)} for ${strength}`, rows),
        orderBy: () => lazy(`select ${name(table)}`, rows),
      };
    };
    return { where, leftJoin: () => ({ where }) };
  };
  const db = {
    execute: (statement: SQL) => {
      state.executed.push(statement);
      return step("execute", { rows: state.executeRows });
    },
    select: () => ({ from: selectChain }),
    insert: (table: Table) => ({
      values: (values: unknown) => {
        state.values.push(values);
        return {
          onConflictDoNothing: () => step(`insert ${name(table)}`, undefined),
          onConflictDoUpdate: () => step(`upsert ${name(table)}`, undefined),
        };
      },
    }),
    delete: (table: Table) => ({
      where: (predicate: unknown) => {
        state.wheres.push(predicate);
        return {
          ...lazy(`delete ${name(table)}`, () => undefined),
          returning: () =>
            lazy(`delete ${name(table)}`, () => state.rows[`deleted ${name(table)}`] ?? []),
        };
      },
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => {
      state.log.push("begin");
      const result = await cb(db);
      state.log.push("commit");
      return result;
    },
  };
  return { getDb: () => db };
});
vi.mock("@/lib/telemetry", () => ({ recordError }));

import {
  countOwnQuizResults,
  deleteOwnQuizResults,
  deleteResultsForCode,
  listOwnQuizResults,
  saveQuizResult,
} from "@/lib/quiz-result-store";
import { listOwnResolvedReportDates } from "@/lib/report-store";
import { loadStudentFacts } from "@/lib/student-facts-store";
import { getUserSettings, updateUserSettings } from "@/lib/user-settings-store";

const RESULT = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  code: "a1b2c3d4e5",
  correct: 3,
  partial: 1,
  incorrect: 0,
  unanswered: 1,
  total: 5,
};

const dialect = new PgDialect();
const render = (statement: unknown) => dialect.sqlToQuery(statement as SQL);

/** A Drizzle-shaped failure whose message embeds SQL parameters (user id, counts). */
function drizzleError() {
  const cause = Object.assign(new Error("deadlock detected"), { code: "40P01" });
  return Object.assign(new Error("Failed query: insert … params: user-secret-id,3,1"), { cause });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.assign(fake.state, {
    log: [],
    rows: { novedu_codes: [{ code: RESULT.code }] },
    executeRows: [],
    executed: [],
    values: [],
    wheres: [],
    failOn: undefined,
    error: undefined,
  });
});

describe("saveQuizResult", () => {
  it("this-time: one transaction — advisory lock, code row FOR SHARE, insert, prune", async () => {
    await expect(saveQuizResult("u1", RESULT, "this-time")).resolves.toBe("saved");
    expect(fake.state.log).toEqual([
      "begin",
      "execute",
      "select novedu_codes for share",
      "insert novedu_quiz_results",
      "execute",
      "commit",
    ]);
    const lock = render(fake.state.executed[0]);
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.params).toEqual(["u1", RESULT.code]);
    expect(fake.state.values[0]).toEqual({ ...RESULT, userId: "u1", finishedAt: expect.any(Date) });
    const prune = render(fake.state.executed[1]);
    expect(prune.sql).toMatch(/^\s*DELETE FROM novedu_quiz_results r/);
    expect(prune.params).toEqual(["u1", RESULT.code, "u1", RESULT.code, 50, "u1", RESULT.code]);
  });

  it("writes nothing when the code row is gone (deleted before the lock)", async () => {
    fake.state.rows.novedu_codes = [];
    await expect(saveQuizResult("u1", RESULT, "this-time")).resolves.toBe("code-gone");
    expect(fake.state.log).not.toContain("insert novedu_quiz_results");
  });

  it("always: turns the setting on inside the same transaction, before the insert", async () => {
    await expect(saveQuizResult("u1", RESULT, "always")).resolves.toBe("saved");
    expect(fake.state.log).toEqual([
      "begin",
      "execute",
      "select novedu_codes for share",
      "upsert novedu_user_settings",
      "insert novedu_quiz_results",
      "execute",
      "commit",
    ]);
  });

  it("automatic: reads the setting FOR SHARE and writes only while it is on", async () => {
    await expect(saveQuizResult("u1", RESULT, "automatic")).resolves.toBe("not-saved");
    expect(fake.state.log).toContain("select novedu_user_settings for share");
    expect(fake.state.log).not.toContain("insert novedu_quiz_results");

    fake.state.log = [];
    fake.state.rows.novedu_user_settings = [{ saveQuizResults: true }];
    await expect(saveQuizResult("u1", RESULT, "automatic")).resolves.toBe("saved");
    expect(fake.state.log).toContain("insert novedu_quiz_results");
  });

  it("a failure anywhere rolls back and resolves undefined", async () => {
    fake.state.failOn = "execute";
    fake.state.error = drizzleError();
    await expect(saveQuizResult("u1", RESULT, "always")).resolves.toBeUndefined();
    expect(fake.state.log).not.toContain("commit");
  });
});

/** The rendered `.where()` predicates, so a test asserts WHOSE rows a statement touches. */
const predicates = () => fake.state.wheres.map((w) => render(w));
const OWN_ROWS = { sql: '"novedu_quiz_results"."user_id" = $1', params: ["u1"] };

describe("own results", () => {
  it("counts only the session user's rows", async () => {
    fake.state.rows.novedu_quiz_results = [{ n: 7 }];
    await expect(countOwnQuizResults("u1")).resolves.toBe(7);
    expect(predicates()).toEqual([OWN_ROWS]);
  });

  it("lists only the session user's rows", async () => {
    await listOwnQuizResults("u1");
    expect(predicates()).toEqual([OWN_ROWS]);
  });

  it("deletes them after locking the settings row FOR UPDATE (inserted first when missing)", async () => {
    fake.state.rows["deleted novedu_quiz_results"] = [{ id: "a" }, { id: "b" }];
    await expect(deleteOwnQuizResults("u1")).resolves.toBe(2);
    // The settings lock, then the delete — both keyed by the session user only.
    expect(predicates()).toEqual([
      { sql: '"novedu_user_settings"."user_id" = $1', params: ["u1"] },
      OWN_ROWS,
    ]);
    expect(fake.state.log).toEqual([
      "begin",
      "insert novedu_user_settings",
      "select novedu_user_settings for update",
      "delete novedu_quiz_results",
      "commit",
    ]);
  });

  it("the code-delete helper drops the code's rows and rethrows (the delete must roll back)", async () => {
    const { getDb } = await import("@/lib/db");
    await expect(deleteResultsForCode(getDb(), RESULT.code)).resolves.toBeUndefined();
    expect(fake.state.log).toEqual(["delete novedu_quiz_results"]);
    fake.state.failOn = "delete";
    fake.state.error = drizzleError();
    await expect(deleteResultsForCode(getDb(), RESULT.code)).rejects.toBe(fake.state.error);
  });
});

describe("user-settings-store", () => {
  it("a missing row reads as the defaults", async () => {
    await expect(getUserSettings("u1")).resolves.toEqual({ saveQuizResults: false });
    fake.state.rows.novedu_user_settings = [{ saveQuizResults: true }];
    await expect(getUserSettings("u1")).resolves.toEqual({ saveQuizResults: true });
  });

  it("upserts only the given fields; an empty patch runs no statement", async () => {
    await expect(updateUserSettings("u1", { saveQuizResults: true })).resolves.toBe(true);
    expect(fake.state.log).toEqual(["upsert novedu_user_settings"]);
    expect(fake.state.values[0]).toEqual({ userId: "u1", saveQuizResults: true });
    fake.state.log = [];
    await expect(updateUserSettings("u1", {})).resolves.toBe(true);
    expect(fake.state.log).toEqual([]);
  });
});

describe("report-store: own resolved dates", () => {
  it("returns only the resolution dates, as the statement orders them", async () => {
    fake.state.executeRows = [{ day: "2026-09-02" }, { day: "2026-09-09" }];
    await expect(listOwnResolvedReportDates("u1")).resolves.toEqual(["2026-09-02", "2026-09-09"]);
    const statement = render(fake.state.executed[0]);
    expect(statement.sql).toContain("r.resolved_at IS NOT NULL");
    expect(statement.params).toContain("u1");
  });
});

describe("student-facts-store", () => {
  it("scopes every statement it runs to the session user", async () => {
    await loadStudentFacts("u1");
    // Usage, coding keys and resolved reports are raw statements; the quiz group
    // is the own-results query.
    expect(fake.state.executed).toHaveLength(3);
    for (const statement of fake.state.executed) {
      expect(render(statement).params).toContain("u1");
    }
    expect(predicates()).toEqual([OWN_ROWS]);
  });
});

describe("failures never throw and never pass the raw error on", () => {
  const cases: [string, string, string, () => Promise<unknown>, unknown][] = [
    [
      "quiz-result-store",
      "save result",
      "insert",
      () => saveQuizResult("u1", RESULT, "this-time"),
      undefined,
    ],
    [
      "quiz-result-store",
      "count own results",
      "select",
      () => countOwnQuizResults("u1"),
      undefined,
    ],
    [
      "quiz-result-store",
      "delete own results",
      "delete",
      () => deleteOwnQuizResults("u1"),
      undefined,
    ],
    ["user-settings-store", "read settings", "select", () => getUserSettings("u1"), undefined],
    [
      "user-settings-store",
      "update settings",
      "upsert",
      () => updateUserSettings("u1", { saveQuizResults: true }),
      false,
    ],
    [
      "report-store",
      "list own resolved dates",
      "execute",
      () => listOwnResolvedReportDates("u1"),
      undefined,
    ],
  ];

  it.each(cases)("%s: %s", async (store, op, failOn, call, failed) => {
    fake.state.failOn = failOn;
    fake.state.error = drizzleError();
    await expect(call()).resolves.toEqual(failed);

    expect(recordError).toHaveBeenCalledTimes(1);
    const [error, attributes] = recordError.mock.calls[0] ?? [];
    expect((error as Error).message).toBe(`${store}: ${op} failed`);
    expect((error as Error).cause).toBeUndefined();
    expect(attributes).toEqual({ store, op, sqlState: "40P01" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("user-secret-id");
    expect(JSON.stringify(recordError.mock.calls)).not.toContain("user-secret-id");
  });
});
