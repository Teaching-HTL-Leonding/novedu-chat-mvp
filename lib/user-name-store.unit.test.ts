import { beforeEach, describe, expect, it, vi } from "vitest";

// The user-name store upsert: one INSERT .. ON CONFLICT DO UPDATE. Behavior-level
// test with a fake drizzle handle — what gets inserted and what the conflict
// target/set are, and that a database error propagates (the auth caller
// swallows it, but the store itself must not hide it). No DB, runs in CI.

const fake = vi.hoisted(() => {
  const state = {
    inserted: [] as Record<string, unknown>[],
    conflicts: [] as { target: unknown; set: Record<string, unknown> }[],
    insertError: undefined as unknown,
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
  return { state, db: { insert } };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import { users } from "@/lib/db/schema";
import { upsertUserName } from "@/lib/user-name-store";

beforeEach(() => {
  fake.state.inserted = [];
  fake.state.conflicts = [];
  fake.state.insertError = undefined;
});

describe("upsertUserName", () => {
  it("upserts via a single INSERT .. ON CONFLICT DO UPDATE", async () => {
    await upsertUserName({ userId: "oid-1", displayName: "Ada Lovelace" });
    expect(fake.state.inserted).toEqual([{ userId: "oid-1", displayName: "Ada Lovelace" }]);
    expect(fake.state.conflicts).toEqual([
      { target: users.userId, set: { displayName: "Ada Lovelace" } },
    ]);
  });

  it("propagates a database error (the auth caller swallows it, not this store)", async () => {
    fake.state.insertError = new Error("connection reset");
    await expect(upsertUserName({ userId: "oid-1", displayName: "Ada" })).rejects.toThrow(
      "connection reset",
    );
  });
});
