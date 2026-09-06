import { beforeEach, describe, expect, it, vi } from "vitest";

// The writing store's upsert (saveSubmission, one INSERT .. ON CONFLICT DO
// UPDATE) and its savers list (listSavers, a SELECT + LEFT JOIN + a raw-SQL
// correlated subquery over Mastra). Behavior-level tests with a fake drizzle
// handle — what gets written / what comes back — not SQL-text assertions. No
// database, runs in CI.

const fake = vi.hoisted(() => {
  const state = {
    inserted: [] as Record<string, unknown>[],
    conflicts: [] as { target: unknown; set: Record<string, unknown> }[],
    insertError: undefined as unknown,
    rows: [] as unknown[],
    order: [] as unknown[],
    selectError: undefined as unknown,
  };
  const insert = () => ({
    values: (values: Record<string, unknown>) => {
      state.inserted.push(values);
      return {
        onConflictDoUpdate: async (config: { target: unknown; set: Record<string, unknown> }) => {
          if (state.insertError) throw state.insertError;
          state.conflicts.push(config);
        },
      };
    },
  });
  const queryTail = () => {
    const run = () =>
      state.selectError ? Promise.reject(state.selectError) : Promise.resolve(state.rows);
    return {
      orderBy: (...order: unknown[]) => {
        state.order = order;
        return run();
      },
      // biome-ignore lint/suspicious/noThenProperty: being awaitable is the point — it mimics drizzle's thenable query builder
      then: (...args: Parameters<Promise<unknown[]>["then"]>) => run().then(...args),
    };
  };
  const fromTail = () => {
    const tail = {
      leftJoin: () => tail,
      where: () => queryTail(),
    };
    return tail;
  };
  const select = () => ({ from: () => fromTail() });
  return { state, db: { insert, select } };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import { writingSubmissions } from "@/lib/db/schema";
import { listSavers, saveSubmission } from "@/lib/writing-store";

beforeEach(() => {
  fake.state.inserted = [];
  fake.state.conflicts = [];
  fake.state.insertError = undefined;
  fake.state.rows = [];
  fake.state.order = [];
  fake.state.selectError = undefined;
  vi.useRealTimers();
});

describe("saveSubmission", () => {
  it("upserts via a single INSERT .. ON CONFLICT DO UPDATE, stamping the same now on both sides", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T08:00:00Z"));
    try {
      await saveSubmission({ code: "a1b2c3d4e5", userId: "student-1", text: "hello" });
    } finally {
      vi.useRealTimers();
    }
    const now = new Date("2026-07-01T08:00:00Z");
    expect(fake.state.inserted).toEqual([
      { code: "a1b2c3d4e5", userId: "student-1", text: "hello", textUpdatedAt: now },
    ]);
    expect(fake.state.conflicts).toEqual([
      {
        target: [writingSubmissions.code, writingSubmissions.userId],
        set: { text: "hello", textUpdatedAt: now },
      },
    ]);
  });

  it("propagates a database error (the caller must not show a save as successful)", async () => {
    fake.state.insertError = new Error("connection lost");
    await expect(
      saveSubmission({ code: "a1b2c3d4e5", userId: "student-1", text: "hello" }),
    ).rejects.toThrow("connection lost");
  });
});

describe("listSavers", () => {
  it("maps rows to { userId, displayName, conversationCount }, newest save first", async () => {
    fake.state.rows = [
      {
        userId: "student-1",
        displayName: "Ada Lovelace",
        textUpdatedAt: new Date(0),
        conversationCount: 3,
      },
      // No `novedu_users` row yet — the caller falls back to the raw oid.
      { userId: "student-2", displayName: null, textUpdatedAt: new Date(0), conversationCount: 0 },
    ];
    await expect(listSavers("a1b2c3d4e5")).resolves.toEqual([
      {
        userId: "student-1",
        displayName: "Ada Lovelace",
        textUpdatedAt: new Date(0),
        conversationCount: 3,
      },
      {
        userId: "student-2",
        displayName: null,
        textUpdatedAt: new Date(0),
        conversationCount: 0,
      },
    ]);
    expect(fake.state.order).toHaveLength(1); // ORDER BY textUpdatedAt DESC
  });

  it("returns an empty list instead of throwing when the database is down", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fake.state.selectError = new Error("connection lost");
      await expect(listSavers("a1b2c3d4e5")).resolves.toEqual([]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
