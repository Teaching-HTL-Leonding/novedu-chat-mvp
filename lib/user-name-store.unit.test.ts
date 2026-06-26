import { beforeEach, describe, expect, it, vi } from "vitest";

// The user-name store upsert: INSERT, falling back to UPDATE on a duplicate primary
// key (the user has signed in before). Behavior-level test with a fake drizzle
// handle — what gets inserted/updated, and that a non-duplicate error propagates
// (the auth caller swallows it, but the store itself must not hide it). No DB, runs
// in CI.

const fake = vi.hoisted(() => {
  const state = {
    inserted: [] as Record<string, unknown>[],
    updated: [] as Record<string, unknown>[],
    insertError: undefined as unknown,
  };
  const insert = () => ({
    values: async (values: Record<string, unknown>) => {
      if (state.insertError) throw state.insertError;
      state.inserted.push(values);
    },
  });
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        state.updated.push(values);
      },
    }),
  });
  return { state, db: { insert, update } };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import { upsertUserName } from "@/lib/user-name-store";

// A duplicate-key error shaped like the driver's: the mssql error number lives in
// the `cause` chain of a DrizzleQueryError (see isDuplicateKeyError in the store).
function duplicateKeyError(number = 2627): Error {
  return Object.assign(new Error("Violation of PRIMARY KEY"), {
    cause: Object.assign(new Error("dup"), { number }),
  });
}

beforeEach(() => {
  fake.state.inserted = [];
  fake.state.updated = [];
  fake.state.insertError = undefined;
});

describe("upsertUserName", () => {
  it("inserts a fresh row when the user is new", async () => {
    await upsertUserName({ userId: "oid-1", displayName: "Ada Lovelace" });
    expect(fake.state.inserted).toEqual([{ userId: "oid-1", displayName: "Ada Lovelace" }]);
    expect(fake.state.updated).toEqual([]);
  });

  it("falls back to UPDATE on a duplicate primary key (a returning user's new name)", async () => {
    fake.state.insertError = duplicateKeyError(2627);
    await upsertUserName({ userId: "oid-1", displayName: "Ada B. Lovelace" });
    expect(fake.state.inserted).toEqual([]);
    expect(fake.state.updated).toEqual([{ displayName: "Ada B. Lovelace" }]);
  });

  it("rethrows a non-duplicate database error", async () => {
    fake.state.insertError = new Error("connection reset");
    await expect(upsertUserName({ userId: "oid-1", displayName: "Ada" })).rejects.toThrow(
      "connection reset",
    );
    expect(fake.state.updated).toEqual([]);
  });
});
