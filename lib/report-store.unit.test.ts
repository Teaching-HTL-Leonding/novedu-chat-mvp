import { beforeEach, describe, expect, it, vi } from "vitest";

// Behavior-level tests over a fake drizzle handle — what rows come back and what
// gets written, not SQL text. The real drizzle operators / `containsAny` build
// their SQL against the real schema columns (that never executes here), so the
// filter/condition-building code paths run for real; the fake just yields the
// configured rows. `setReportsResolved` semantics (stamp vs. clear both columns)
// and the never-throw error contract are asserted directly.
const fake = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    joins: [] as unknown[],
    selectError: undefined as unknown,
    inserted: [] as Record<string, unknown>[],
    insertError: undefined as unknown,
    updated: [] as Record<string, unknown>[],
    updateError: undefined as unknown,
    deletes: 0,
    deleteError: undefined as unknown,
  };
  const run = () =>
    state.selectError ? Promise.reject(state.selectError) : Promise.resolve(state.rows);
  // One chainable, thenable builder: from/leftJoin/where return it, orderBy (and
  // awaiting it directly, for the COUNT selects) resolves the configured rows.
  const builder = {
    from: () => builder,
    leftJoin: (table: unknown) => {
      state.joins.push(table);
      return builder;
    },
    where: () => builder,
    orderBy: () => run(),
    // biome-ignore lint/suspicious/noThenProperty: being awaitable is the point — it mimics drizzle's thenable query builder
    then: (...args: Parameters<Promise<unknown[]>["then"]>) => run().then(...args),
  };
  const select = () => builder;
  const insert = () => ({
    values: async (values: Record<string, unknown>) => {
      if (state.insertError) throw state.insertError;
      state.inserted.push(values);
    },
  });
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        if (state.updateError) throw state.updateError;
        state.updated.push(values);
      },
    }),
  });
  const del = () => ({
    where: async () => {
      if (state.deleteError) throw state.deleteError;
      state.deletes += 1;
    },
  });
  return { state, db: { select, insert, update, delete: del } };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import { codes, userChats, users } from "@/lib/db/schema";
import {
  countChatReports,
  countQuizReports,
  deleteReports,
  getReportById,
  insertChatReport,
  insertQuizReport,
  listReports,
  type ReportListRow,
  setReportsResolved,
} from "@/lib/report-store";

const CODE = "a1b2c3d4e5";
const USER = "student-1";
const REPORT_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  fake.state.rows = [];
  fake.state.joins = [];
  fake.state.selectError = undefined;
  fake.state.inserted = [];
  fake.state.insertError = undefined;
  fake.state.updated = [];
  fake.state.updateError = undefined;
  fake.state.deletes = 0;
  fake.state.deleteError = undefined;
});

describe("insertChatReport", () => {
  it("writes a chat row with a generated id + timestamp and no snapshot fields", async () => {
    await expect(
      insertChatReport({
        code: CODE,
        userId: USER,
        threadId: "t-1",
        reaction: "good",
        description: "hi",
      }),
    ).resolves.toBe(true);
    expect(fake.state.inserted[0]).toMatchObject({
      kind: "chat",
      code: CODE,
      userId: USER,
      threadId: "t-1",
      reaction: "good",
      description: "hi",
    });
    expect(fake.state.inserted[0]?.id).toEqual(expect.any(String));
    expect(fake.state.inserted[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("returns false instead of throwing on a database error", async () => {
    fake.state.insertError = new Error("connection lost");
    await expect(
      insertChatReport({
        code: CODE,
        userId: USER,
        threadId: "t-1",
        reaction: "good",
        description: "",
      }),
    ).resolves.toBe(false);
  });
});

describe("insertQuizReport", () => {
  it("writes a quiz row carrying the snapshot", async () => {
    await expect(
      insertQuizReport({
        code: CODE,
        userId: USER,
        questionId: "q1",
        questionText: "Q",
        answerText: "A",
        feedbackText: "F",
        verdict: "partial",
        hadImages: true,
        reaction: "holysh",
        description: "d",
      }),
    ).resolves.toBe(true);
    expect(fake.state.inserted[0]).toMatchObject({
      kind: "quiz-answer",
      questionId: "q1",
      questionText: "Q",
      answerText: "A",
      feedbackText: "F",
      verdict: "partial",
      hadImages: true,
    });
  });
});

describe("count helpers", () => {
  it("countChatReports returns the COUNT(*) value", async () => {
    fake.state.rows = [{ n: 2 }];
    await expect(countChatReports("t-1", USER)).resolves.toBe(2);
  });

  it("countQuizReports returns 0 when there are no rows", async () => {
    fake.state.rows = [];
    await expect(countQuizReports(CODE, USER, "q1")).resolves.toBe(0);
  });

  it("returns undefined instead of throwing on a database error", async () => {
    fake.state.selectError = new Error("connection lost");
    await expect(countChatReports("t-1", USER)).resolves.toBeUndefined();
    await expect(countQuizReports(CODE, USER, "q1")).resolves.toBeUndefined();
  });
});

describe("listReports", () => {
  const rawRow: ReportListRow = {
    id: REPORT_ID,
    kind: "quiz-answer",
    code: CODE,
    codeNote: "linked lists",
    userId: USER,
    displayName: "Alice",
    reaction: "holysh",
    description: "d",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    threadId: null,
    questionId: "q1",
    questionText: "Q",
    answerText: "A",
    feedbackText: "F",
    verdict: "correct",
    hadImages: true,
    resolvedAt: null,
    resolvedBy: null,
  };

  it("maps rows through for the configured filters (open/resolved/all + reaction + search + mine)", async () => {
    fake.state.rows = [rawRow];
    // Each filter combination exercises a different condition-building branch; the
    // fake yields the same rows regardless (the WHERE itself is an @live concern).
    await expect(listReports({ status: "open" })).resolves.toEqual([rawRow]);
    await expect(listReports({ status: "resolved" })).resolves.toEqual([rawRow]);
    await expect(
      listReports({
        status: "all",
        reaction: "holysh",
        search: "lists",
        codeCreatedBy: "teacher-1",
      }),
    ).resolves.toEqual([rawRow]);
  });

  it("returns undefined instead of throwing when the database is down", async () => {
    fake.state.selectError = new Error("connection lost");
    await expect(listReports({ status: "open" })).resolves.toBeUndefined();
  });

  it("LEFT-JOINs novedu_users + novedu_codes and NEVER novedu_user_chats", async () => {
    fake.state.rows = [rawRow];
    await listReports({ status: "open" });
    expect(fake.state.joins).toContain(users);
    expect(fake.state.joins).toContain(codes);
    // The sanctioned-exception discipline: the only identity surfaced is the
    // reporter's own — a `novedu_user_chats` join would reveal a different
    // student behind a reported thread (docs/reports.md).
    expect(fake.state.joins).not.toContain(userChats);
  });
});

describe("getReportById", () => {
  const chatRow: ReportListRow = {
    id: REPORT_ID,
    kind: "chat",
    code: CODE,
    codeNote: "linked lists",
    userId: USER,
    displayName: "Alice",
    reaction: "bad",
    description: "d",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    threadId: "t-1",
    questionId: null,
    questionText: null,
    answerText: null,
    feedbackText: null,
    verdict: null,
    hadImages: false,
    resolvedAt: null,
    resolvedBy: null,
  };

  it("returns the single mapped row when found", async () => {
    fake.state.rows = [chatRow];
    await expect(getReportById(REPORT_ID)).resolves.toEqual(chatRow);
  });

  it("returns null (not undefined) when no report has that id", async () => {
    fake.state.rows = [];
    await expect(getReportById(REPORT_ID)).resolves.toBeNull();
  });

  it("returns undefined instead of throwing on a database error", async () => {
    fake.state.selectError = new Error("connection lost");
    await expect(getReportById(REPORT_ID)).resolves.toBeUndefined();
  });

  it("LEFT-JOINs novedu_users + novedu_codes and NEVER novedu_user_chats", async () => {
    fake.state.rows = [chatRow];
    await getReportById(REPORT_ID);
    expect(fake.state.joins).toContain(users);
    expect(fake.state.joins).toContain(codes);
    expect(fake.state.joins).not.toContain(userChats);
  });
});

describe("setReportsResolved", () => {
  it("stamps resolved_at + resolved_by when resolving", async () => {
    await expect(setReportsResolved([REPORT_ID], true, "teacher-1")).resolves.toBe(true);
    expect(fake.state.updated[0]?.resolvedAt).toBeInstanceOf(Date);
    expect(fake.state.updated[0]?.resolvedBy).toBe("teacher-1");
  });

  it("nulls BOTH resolution columns when reopening", async () => {
    await expect(setReportsResolved([REPORT_ID], false, "teacher-1")).resolves.toBe(true);
    expect(fake.state.updated[0]).toEqual({ resolvedAt: null, resolvedBy: null });
  });

  it("is a no-op for an empty id list", async () => {
    await expect(setReportsResolved([], true, "teacher-1")).resolves.toBe(true);
    expect(fake.state.updated).toHaveLength(0);
  });

  it("returns false instead of throwing on a database error", async () => {
    fake.state.updateError = new Error("connection lost");
    await expect(setReportsResolved([REPORT_ID], true, "teacher-1")).resolves.toBe(false);
  });
});

describe("deleteReports", () => {
  it("deletes the given ids", async () => {
    await expect(deleteReports([REPORT_ID])).resolves.toBe(true);
    expect(fake.state.deletes).toBe(1);
  });

  it("is a no-op for an empty id list", async () => {
    await expect(deleteReports([])).resolves.toBe(true);
    expect(fake.state.deletes).toBe(0);
  });

  it("returns false instead of throwing on a database error", async () => {
    fake.state.deleteError = new Error("connection lost");
    await expect(deleteReports([REPORT_ID])).resolves.toBe(false);
  });
});
