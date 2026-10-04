// @vitest-environment node
import { eq, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The teacher facts store against a recording fake: every statement is keyed by
// the teacher (codes they created), each group fails on its own, and a failure
// is reported with a fixed message, never the raw error.

const fake = vi.hoisted(() => {
  const state = {
    codeRows: [] as unknown[],
    codesWhere: undefined as unknown,
    executed: [] as unknown[],
    /** Rows per statement, matched on a fragment of its SQL. */
    rowsFor: [] as [string, unknown[]][],
    /** SQL fragments whose statement fails. */
    failing: [] as string[],
    codesFail: false,
  };
  const db = {
    select: () => ({
      from: () => ({
        where: (where: unknown) => {
          state.codesWhere = where;
          return state.codesFail
            ? Promise.reject(
                Object.assign(new Error("Failed query: teacher-secret-id"), { code: "57014" }),
              )
            : Promise.resolve(state.codeRows);
        },
      }),
    }),
    execute: (statement: unknown) => {
      state.executed.push(statement);
      return Promise.resolve().then(() => {
        const { sql } = render(statement);
        if (state.failing.some((f) => sql.includes(f))) {
          throw Object.assign(new Error("Failed query … params: teacher-secret-id"), {
            cause: Object.assign(new Error("boom"), { code: "57014" }),
          });
        }
        return { rows: state.rowsFor.find(([f]) => sql.includes(f))?.[1] ?? [] };
      });
    },
  };
  return { state, db };
});

const recordError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));
vi.mock("@/lib/telemetry", () => ({ recordError }));

import { codes } from "@/lib/db/schema";
import {
  conversationsStatement,
  loadTeacherFacts,
  studentsStatement,
  usageStatement,
} from "@/lib/teacher-facts-store";

const render = (statement: unknown) => new PgDialect().sqlToQuery(statement as SQL);
const NOW = new Date("2026-10-04T17:30:00Z");
const START = new Date("2026-09-04T22:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.assign(fake.state, {
    codeRows: [],
    codesWhere: undefined,
    executed: [],
    rowsFor: [],
    failing: [],
    codesFail: false,
  });
});

describe("loadTeacherFacts", () => {
  it("maps every group, numbers from Postgres strings included", async () => {
    fake.state.codeRows = [
      {
        code: "C1",
        module: "quiz",
        note: "n",
        validFrom: null,
        validUntil: null,
        createdAt: NOW,
      },
      // An unknown module is no activity: dropped.
      { code: "C2", module: "legacy", note: "", validFrom: null, validUntil: null, createdAt: NOW },
    ];
    fake.state.rowsFor = [
      [
        "novedu_usage_by_code",
        [
          {
            code: "C1",
            interactions: "12",
            outsideSchool: "5",
            quizAnswers: "4",
            inputTokens: "9000",
            outputTokens: "700",
          },
        ],
      ],
      ["mastra_threads", [{ conversations: "3" }]],
      ["count(DISTINCT", [{ students: "8" }]],
      ["novedu_reports", [{ code: "C1", open: "2" }]],
    ];
    const facts = await loadTeacherFacts("t1", NOW);
    expect(facts).toEqual({
      codes: [
        {
          code: "C1",
          module: "quiz",
          note: "n",
          validFrom: null,
          validUntil: null,
          createdAt: NOW,
        },
      ],
      usage: [
        {
          code: "C1",
          interactions: 12,
          outsideSchool: 5,
          quizAnswers: 4,
          inputTokens: 9000,
          outputTokens: 700,
        },
      ],
      conversations: 3,
      students: 8,
      reports: [{ code: "C1", open: 2 }],
    });
    expect(fake.state.codesWhere).toEqual(eq(codes.createdBy, "t1"));
  });

  it("runs every statement restricted to the teacher's own codes, the window from local midnight", async () => {
    await loadTeacherFacts("t1", NOW);
    expect(fake.state.executed).toHaveLength(4);
    for (const statement of fake.state.executed) {
      const { sql, params } = render(statement);
      expect(sql).toContain("created_by");
      expect(params).toContain("t1");
      // Never the students' saved quiz results.
      expect(sql).not.toContain("novedu_quiz_results");
    }
    const windowed = fake.state.executed
      .map(render)
      .filter(({ sql }) => sql.includes("hour >=") || sql.includes('"createdAtZ" >='));
    expect(windowed).toHaveLength(2);
    for (const { params } of windowed) expect(params).toContainEqual(START);
  });

  it("each group fails alone: the others still load, the failed one is undefined", async () => {
    fake.state.failing = ["mastra_threads"];
    fake.state.rowsFor = [["count(DISTINCT", [{ students: "1" }]]];
    const facts = await loadTeacherFacts("t1", NOW);
    expect(facts.conversations).toBeUndefined();
    expect(facts.students).toBe(1);
    expect(facts.codes).toEqual([]);
    expect(facts.usage).toEqual([]);
    expect(facts.reports).toEqual([]);
  });

  it.each([
    ["novedu_usage_by_code", "usage", "teacher-facts-store", "load usage"],
    ["mastra_threads", "conversations", "teacher-facts-store", "count conversations"],
    ["count(DISTINCT", "students", "teacher-facts-store", "count students"],
    ["novedu_reports", "reports", "report-store", "count open reports"],
  ] as const)(
    "a failing %s statement reports a fixed message, never the raw error",
    async (fragment, group, store, op) => {
      fake.state.failing = [fragment];
      const facts = await loadTeacherFacts("t1", NOW);
      expect(facts[group]).toBeUndefined();
      expect(recordError).toHaveBeenCalledTimes(1);
      const [error, attributes] = recordError.mock.calls[0] ?? [];
      expect((error as Error).message).toBe(`${store}: ${op} failed`);
      expect(attributes).toEqual({ store, op, sqlState: "57014" });
      expect(JSON.stringify(recordError.mock.calls)).not.toContain("teacher-secret-id");
    },
  );

  it("a failing codes read is reported the same way", async () => {
    fake.state.codesFail = true;
    const facts = await loadTeacherFacts("t1", NOW);
    expect(facts.codes).toBeUndefined();
    const [error] = recordError.mock.calls[0] ?? [];
    expect((error as Error).message).toBe("teacher-facts-store: list codes failed");
  });
});

describe("statement shapes", () => {
  it("usage: the outside-school rule matches isSchoolHour's constants", () => {
    const { sql, params } = render(usageStatement("t1", START));
    expect(sql).toContain("isodow");
    // SCHOOL_DAY_START / SCHOOL_DAY_END and the time zone travel as parameters.
    expect(params).toEqual(expect.arrayContaining([8, 17, "Europe/Vienna", "t1", START]));
  });

  it("conversations: threads with a user message in the window (the EXISTS shape)", () => {
    const { sql } = render(conversationsStatement("t1", START));
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM mastra\.mastra_messages m/);
    expect(sql).toContain("m.role = 'user'");
  });

  it("students: per-user chats and texts only on non-anonymous codes, key holders, never the teacher", () => {
    const { sql, params } = render(studentsStatement("t1"));
    expect(sql).toContain("novedu_user_chats");
    expect(sql).toContain("novedu_writing_submissions");
    expect(sql).toContain("novedu_coding_keys");
    expect(sql.match(/NOT c\.anonymous/g)).toHaveLength(2);
    expect(sql).toContain("s.user_id <>");
    expect(params.filter((p) => p === "t1")).toHaveLength(4);
  });
});
