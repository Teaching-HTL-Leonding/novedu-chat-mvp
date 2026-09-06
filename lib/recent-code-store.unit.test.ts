import { and, eq, notInArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake drizzle handle covering the recents store's query shapes:
// select().from().innerJoin().where().orderBy().limit(),
// insert().values().onConflictDoUpdate(), delete().where().
const fake = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    selectError: undefined as unknown,
    inserted: [] as Record<string, unknown>[],
    insertError: undefined as unknown,
    // The `{ target, set }` passed to `onConflictDoUpdate`, per call.
    conflicts: [] as { target: unknown; set: unknown }[],
    deletes: 0,
    // The WHERE terms of each DELETE, in call order. Captured because a prune's
    // predicate is the only thing standing between "drop the overflow" and
    // "drop the whole table": counting the call proves a DELETE happened, never
    // that it was scoped.
    deleteWhere: [] as unknown[][],
    // The most recent `select()…limit()` builder handed out — the prune passes it
    // UN-awaited into `notInArray` as a subquery, so the test needs its identity.
    lastLimited: undefined as unknown,
  };
  // The query tail is a lazy thenable (NOT an eager promise): the rejected
  // promise only comes into existence when the store actually awaits it, so
  // error-path tests don't leak unhandled rejections.
  const queryTail = () => {
    const run = () =>
      state.selectError ? Promise.reject(state.selectError) : Promise.resolve(state.rows);
    // `then` makes the builder awaitable, like drizzle's thenable query builder.
    const then = (...args: Parameters<Promise<unknown[]>["then"]>) => run().then(...args);
    return {
      orderBy: () => ({
        limit: () => {
          state.lastLimited = { then };
          return state.lastLimited;
        },
      }),
      then,
    };
  };
  const selectChain = () => {
    const tail = { where: () => queryTail(), innerJoin: () => tail };
    return { from: () => tail };
  };
  const db = {
    select: () => selectChain(),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async (conflict: { target: unknown; set: unknown }) => {
          if (state.insertError) throw state.insertError;
          state.inserted.push(values);
          state.conflicts.push(conflict);
        },
      }),
    }),
    delete: () => ({
      where: async (...conditions: unknown[]) => {
        state.deletes += 1;
        state.deleteWhere.push(conditions);
      },
    }),
  };
  return { state, db };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import { recentCodes } from "@/lib/db/schema";

import { listRecentCodes, recordRecentCode, removeRecentCode } from "@/lib/recent-code-store";

const USER = "student-sub-1";
const CODE = "a1b2c3d4e5";

beforeEach(() => {
  fake.state.rows = [];
  fake.state.selectError = undefined;
  fake.state.inserted = [];
  fake.state.insertError = undefined;
  fake.state.conflicts = [];
  fake.state.deletes = 0;
  fake.state.deleteWhere = [];
  fake.state.lastLimited = undefined;
});

describe("listRecentCodes", () => {
  it("returns the joined rows (code + teacher note)", async () => {
    const rows = [{ code: CODE, note: "My class", lastUsed: new Date() }];
    fake.state.rows = rows;
    await expect(listRecentCodes(USER)).resolves.toEqual(rows);
  });

  it("reads as an empty list instead of throwing when the database is down", async () => {
    fake.state.selectError = new Error("connection lost");
    await expect(listRecentCodes(USER)).resolves.toEqual([]);
  });
});

describe("recordRecentCode", () => {
  it("inserts a fresh entry and prunes beyond the cap", async () => {
    await recordRecentCode(USER, CODE);
    expect(fake.state.inserted).toEqual([
      expect.objectContaining({ userId: USER, code: CODE, lastUsed: expect.any(Date) }),
    ]);
    expect(fake.state.deletes).toBe(1); // prune
  });

  it("upserts on the (user_id, code) conflict, refreshing last_used", async () => {
    await recordRecentCode(USER, CODE);
    expect(fake.state.conflicts).toEqual([
      {
        target: [recentCodes.userId, recentCodes.code],
        set: { lastUsed: expect.any(Date) },
      },
    ]);
  });

  // The prune is a DELETE with no LIMIT: its entire safety is the predicate.
  // Counting the call (above) passes just as happily when the WHERE is dropped
  // or loses a term — which would delete every OTHER user's recents, or this
  // user's whole list rather than only the overflow. So pin both terms: the
  // user, and NOT IN the survivor subquery (the newest-N SELECT, un-awaited).
  it("scopes the prune to this user AND to the codes outside the survivor subquery", async () => {
    await recordRecentCode(USER, CODE);

    expect(fake.state.lastLimited).toBeDefined();
    expect(fake.state.deleteWhere).toEqual([
      [
        and(
          eq(recentCodes.userId, USER),
          notInArray(recentCodes.code, fake.state.lastLimited as never),
        ),
      ],
    ]);
  });

  it("never throws on database failures", async () => {
    fake.state.insertError = new Error("connection lost");
    await expect(recordRecentCode(USER, CODE)).resolves.toBeUndefined();
  });
});

describe("removeRecentCode", () => {
  it("issues one delete", async () => {
    await removeRecentCode(USER, CODE);
    expect(fake.state.deletes).toBe(1);
  });
});
