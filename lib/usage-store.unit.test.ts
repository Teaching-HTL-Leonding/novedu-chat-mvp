import { beforeEach, describe, expect, it, vi } from "vitest";
import { usageByCode, usageByUser } from "@/lib/db/schema";

// The usage-store write seam: hour bucketing, the increment-UPSERT column mapping,
// the userId-absent gate (coding proxy meters only usage_by_code), and the
// never-throws contract. The DB is mocked — the real UPSERT/concurrency is a
// @live-db concern (docs/testing.md); here we assert WHICH table + WHICH deltas.

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertValues: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  recordError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: (table: unknown) => {
      mocks.insert(table);
      return { values: mocks.insertValues };
    },
    update: (table: unknown) => {
      mocks.update(table);
      return {
        set: (setArg: unknown) => {
          mocks.updateSet(setArg);
          return { where: mocks.updateWhere };
        },
      };
    },
  }),
}));
vi.mock("@/lib/telemetry", () => ({ recordError: mocks.recordError }));

import {
  hourBucket,
  recordLlmUsage,
  recordQuizAnswer,
  recordUserMessage,
  recordWritingSave,
} from "@/lib/usage-store";

const CODE = "a1b2c3d4e5";
const USER = "student-oid-1";

const duplicateKeyError = () =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("Violation of PRIMARY KEY constraint"), { number: 2627 }),
  });

// The table object the store hands to insert/update, to assert which table was hit.
const tableOf = (call: unknown[]): unknown => call[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.updateWhere.mockResolvedValue(undefined);
});

describe("hourBucket", () => {
  it("truncates to the top of the UTC hour", () => {
    const b = hourBucket(new Date("2026-07-01T09:37:41.512Z"));
    expect(b.toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });

  it("uses UTC, not local time", () => {
    const b = hourBucket(new Date(Date.UTC(2026, 0, 1, 23, 59, 59)));
    expect(b.toISOString()).toBe("2026-01-01T23:00:00.000Z");
  });
});

describe("recordLlmUsage", () => {
  it("meters BOTH tables when a userId is present, mapping tokens to the right columns", async () => {
    const at = new Date("2026-07-01T09:15:00.000Z");
    await recordLlmUsage({
      code: CODE,
      module: "tutor",
      userId: USER,
      inputNew: 70,
      inputCached: 30,
      output: 50,
      toolCalls: 0,
      at,
    });

    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.insert.mock.calls.map(tableOf)).toEqual([usageByCode, usageByUser]);

    // usage_by_code carries the module; usage_by_user does not.
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        code: CODE,
        module: "tutor",
        hour: hourBucket(at),
        inputTokensNew: 70,
        inputTokensCached: 30,
        outputTokens: 50,
      }),
    );
    const userRow = mocks.insertValues.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(userRow).toMatchObject({ userId: USER, inputTokensNew: 70, outputTokens: 50 });
    expect(userRow).not.toHaveProperty("code");
    expect(userRow).not.toHaveProperty("module");
  });

  it("meters ONLY usage_by_code when there is no userId (the coding-proxy path)", async () => {
    await recordLlmUsage({
      code: CODE,
      module: "coding",
      inputNew: 100,
      inputCached: 0,
      output: 20,
      toolCalls: 0,
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(tableOf(mocks.insert.mock.calls[0] ?? [])).toBe(usageByCode);
  });

  it("writes provider/model to usage_by_code ONLY — never to usage_by_user", async () => {
    await recordLlmUsage({
      code: CODE,
      module: "tutor",
      userId: USER,
      provider: "Azure Foundry",
      model: "gpt-5.4-mini",
      inputNew: 10,
      inputCached: 0,
      output: 5,
      toolCalls: 0,
    });
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: "Azure Foundry", model: "gpt-5.4-mini" }),
    );
    // The anonymity invariant: the per-user row must carry no activity dimension.
    const userRow = mocks.insertValues.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(userRow).not.toHaveProperty("provider");
    expect(userRow).not.toHaveProperty("model");
  });

  it("COALESCE-fills provider/model on the duplicate-key UPDATE (a counter usually creates the bucket first)", async () => {
    mocks.insertValues.mockRejectedValue(duplicateKeyError());
    await recordLlmUsage({
      code: CODE,
      module: "tutor",
      provider: "SCCH",
      model: "some-model",
      inputNew: 5,
      inputCached: 0,
      output: 3,
      toolCalls: 0,
    });
    const setArg = mocks.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toHaveProperty("provider");
    expect(setArg).toHaveProperty("model");
  });

  it("does not touch the provider/model columns when the caller has no attribution", async () => {
    mocks.insertValues.mockRejectedValue(duplicateKeyError());
    await recordUserMessage({ code: CODE, module: "tutor", userId: USER });
    const setArg = mocks.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("provider");
    expect(setArg).not.toHaveProperty("model");
  });

  it("falls back to an increment UPDATE on a duplicate key, and never throws", async () => {
    mocks.insertValues.mockRejectedValue(duplicateKeyError());
    await expect(
      recordLlmUsage({
        code: CODE,
        module: "tutor",
        userId: USER,
        inputNew: 5,
        inputCached: 0,
        output: 3,
        toolCalls: 1,
      }),
    ).resolves.toBeUndefined();
    // Both tables tried insert, both fell back to update.
    expect(mocks.update.mock.calls.map(tableOf)).toEqual([usageByCode, usageByUser]);
    expect(mocks.updateWhere).toHaveBeenCalledTimes(2);
    expect(mocks.recordError).not.toHaveBeenCalled();
  });

  it("swallows a non-duplicate DB error and routes it to recordError (never throws)", async () => {
    mocks.insertValues.mockRejectedValue(new Error("connection lost"));
    await expect(
      recordLlmUsage({
        code: CODE,
        module: "tutor",
        userId: USER,
        inputNew: 1,
        inputCached: 0,
        output: 1,
        toolCalls: 0,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.recordError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ store: "usage", op: "recordLlmUsage" }),
    );
  });
});

describe("discrete counters", () => {
  it("recordUserMessage bumps user_messages on both tables with the caller's module", async () => {
    await recordUserMessage({ code: CODE, module: "writing", userId: USER });
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ code: CODE, module: "writing", userMessages: 1 }),
    );
  });

  it("recordQuizAnswer bumps quiz_answers with module 'quiz'", async () => {
    await recordQuizAnswer({ code: CODE, userId: USER });
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ module: "quiz", quizAnswers: 1 }),
    );
  });

  it("recordWritingSave bumps writing_saves with module 'writing'", async () => {
    await recordWritingSave({ code: CODE, userId: USER });
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ module: "writing", writingSaves: 1 }),
    );
  });
});
