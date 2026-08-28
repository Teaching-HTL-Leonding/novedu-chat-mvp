import { and, eq, notInArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake drizzle handle covering the recents store's query shapes:
// select().top().from().innerJoin().where().orderBy(), insert().values(),
// update().set().where(), delete().where().
const fake = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    selectError: undefined as unknown,
    inserted: [] as Record<string, unknown>[],
    insertError: undefined as unknown,
    updates: 0,
    deletes: 0,
    // The WHERE terms of each DELETE, in call order. Captured because a prune's
    // predicate is the only thing standing between "drop the overflow" and
    // "drop the whole table": counting the call proves a DELETE happened, never
    // that it was scoped.
    deleteWhere: [] as unknown[][],
  };
  // The query tail is a lazy thenable (NOT an eager promise): the rejected
  // promise only comes into existence when the store actually awaits it, so
  // error-path tests don't leak unhandled rejections.
  const queryTail = () => {
    const run = () =>
      state.selectError ? Promise.reject(state.selectError) : Promise.resolve(state.rows);
    return {
      orderBy: () => run(),
      // biome-ignore lint/suspicious/noThenProperty: being awaitable is the point — it mimics drizzle's thenable query builder
      then: (...args: Parameters<Promise<unknown[]>["then"]>) => run().then(...args),
    };
  };
  const selectChain = () => {
    const tail = { where: () => queryTail(), innerJoin: () => tail };
    return { from: () => tail, top: () => ({ from: () => tail }) };
  };
  const db = {
    select: () => selectChain(),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        if (state.insertError) throw state.insertError;
        state.inserted.push(values);
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          state.updates += 1;
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

const duplicateKeyError = () =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("Violation of PRIMARY KEY constraint"), { number: 2627 }),
  });

beforeEach(() => {
  fake.state.rows = [];
  fake.state.selectError = undefined;
  fake.state.inserted = [];
  fake.state.insertError = undefined;
  fake.state.updates = 0;
  fake.state.deletes = 0;
  fake.state.deleteWhere = [];
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
    fake.state.rows = [{ code: CODE }]; // the prune subselect's survivors
    await recordRecentCode(USER, CODE);
    expect(fake.state.inserted).toEqual([
      expect.objectContaining({ userId: USER, code: CODE, lastUsed: expect.any(Date) }),
    ]);
    expect(fake.state.deletes).toBe(1); // prune
    expect(fake.state.updates).toBe(0);
  });

  // The prune is a DELETE with no LIMIT: its entire safety is the predicate.
  // Counting the call (above) passes just as happily when the WHERE is dropped
  // or loses a term — which would delete every OTHER user's recents, or this
  // user's whole list rather than only the overflow. So pin both terms.
  it("scopes the prune to this user AND to the codes outside the survivor set", async () => {
    const survivors = [{ code: CODE }, { code: "b2c3d4e5f6" }];
    fake.state.rows = survivors;

    await recordRecentCode(USER, CODE);

    expect(fake.state.deleteWhere).toEqual([
      [
        and(
          eq(recentCodes.userId, USER),
          notInArray(
            recentCodes.code,
            survivors.map((row) => row.code),
          ),
        ),
      ],
    ]);
  });

  it("refreshes last_used when the entry already exists (duplicate key)", async () => {
    fake.state.insertError = duplicateKeyError();
    fake.state.rows = [{ code: CODE }];
    await recordRecentCode(USER, CODE);
    expect(fake.state.updates).toBe(1);
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
