import { desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake drizzle handle: just enough of the fluent query API for the key store's
// operations (mirroring lib/code-store.unit.test.ts). Behavior-level tests — which
// key comes back / what gets inserted / which tables get deleted — not SQL-text
// assertions. No database, runs in CI; real concurrent get-or-create is a
// @live-db concern (docs/testing.md).
const fake = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    // Queued per-SELECT result sets for a read whose answer CHANGES between calls
    // (the concurrent-mint race); once exhausted, every read answers `rows`.
    rowsSequence: [] as unknown[][],
    inserted: [] as Record<string, unknown>[],
    // Queued per-INSERT outcomes: a truthy entry is thrown instead of storing the
    // row, so a test can script "duplicate, then success".
    insertErrors: [] as unknown[],
    insertCalls: 0,
    // Fails EVERY read; `selectErrors` scripts them one by one instead (an
    // `undefined` entry = that read succeeds), e.g. "the first read is fine, the
    // duplicate fallback read fails".
    selectError: undefined as unknown,
    selectErrors: [] as unknown[],
    selectCalls: 0,
    // The ORDER BY terms of the most recent list query, so a test can pin the
    // newest-first ordering.
    order: [] as unknown[],
    // The WHERE terms of the most recent SELECT. Captured because the predicate
    // IS the authentication here: without it `lookupCodingKey` would answer with
    // whichever key row happens to come back first, and a behavior-only test
    // (seed one row, expect that row) could never tell the difference.
    where: [] as unknown[],
    // The drizzle table objects passed to db.delete(), in call order.
    deletedTables: [] as unknown[],
  };
  // The query tail is a lazy thenable (NOT an eager promise): the rejected
  // promise only comes into existence when the store actually awaits it, so
  // error-path tests don't leak unhandled rejections.
  const queryTail = () => {
    const run = () => {
      state.selectCalls += 1;
      const error = state.selectErrors.shift() ?? state.selectError;
      if (error) return Promise.reject(error);
      return Promise.resolve(state.rowsSequence.shift() ?? state.rows);
    };
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
      where: (...conditions: unknown[]) => {
        state.where = conditions;
        return queryTail();
      },
    };
    return tail;
  };
  const select = () => ({ from: () => fromTail() });
  const insert = () => ({
    values: async (values: Record<string, unknown>) => {
      state.insertCalls += 1;
      const error = state.insertErrors.shift();
      if (error) throw error;
      state.inserted.push(values);
    },
  });
  const del = (table: unknown) => ({
    where: async () => {
      state.deletedTables.push(table);
    },
  });
  return { state, db: { select, insert, delete: del } };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import { generateCodingKey, KEY_PATTERN } from "@/lib/coding-key";
import {
  deleteCodingKeysForCodes,
  getOrCreateCodingKey,
  getStoredCodingKey,
  listCodingKeys,
  lookupCodingKey,
} from "@/lib/coding-key-store";
import { codingKeys } from "@/lib/db/schema";

// mssql duplicate-key errors arrive wrapped (DrizzleQueryError → cause chain).
const duplicateKeyError = () =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("Violation of PRIMARY KEY constraint"), { number: 2627 }),
  });

// A stored row as the store reads it back.
const storedRow = (overrides: Record<string, unknown> = {}) => ({
  code: "a1b2c3d4e5",
  userId: "oid-student-1",
  apiKey: `nvk-${"a".repeat(40)}`,
  createdAt: new Date("2026-08-20T09:00:00Z"),
  ...overrides,
});

beforeEach(() => {
  fake.state.rows = [];
  fake.state.rowsSequence = [];
  fake.state.inserted = [];
  fake.state.insertErrors = [];
  fake.state.insertCalls = 0;
  fake.state.selectError = undefined;
  fake.state.selectErrors = [];
  fake.state.selectCalls = 0;
  fake.state.order = [];
  fake.state.where = [];
  fake.state.deletedTables = [];
});

describe("getOrCreateCodingKey", () => {
  it("mints and stores a fresh key on the first visit", async () => {
    const row = await getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1");
    expect(row).toMatchObject({ code: "a1b2c3d4e5", userId: "oid-student-1" });
    expect(row?.apiKey).toMatch(KEY_PATTERN);
    expect(row?.createdAt).toBeInstanceOf(Date);
    // The read found nothing, so exactly one write followed it.
    expect(fake.state.selectCalls).toBe(1);
    expect(fake.state.inserted).toHaveLength(1);
    expect(fake.state.inserted[0]).toEqual(row);
  });

  it("returns the stored key on a revisit (idempotent) with ONE read and no write", async () => {
    const existing = storedRow();
    fake.state.rows = [existing];

    const first = await getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1");
    expect(first).toEqual(existing);
    // The dominant path — one page view, one SELECT, never a guaranteed-failing
    // INSERT behind it.
    expect(fake.state.selectCalls).toBe(1);
    expect(fake.state.insertCalls).toBe(0);

    // A second revisit reads the same row again.
    await expect(getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toEqual(existing);
    expect(fake.state.insertCalls).toBe(0);
  });

  it("hands back the winner's row when a concurrent first visit wins the INSERT race", async () => {
    // The read saw nothing, then the INSERT hit the pair's PK: the other request
    // stored its key in between, and the re-read finds it.
    const winner = storedRow();
    fake.state.rowsSequence = [[], [winner]];
    fake.state.insertErrors = [duplicateKeyError()];

    await expect(getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toEqual(winner);
    // Nothing of ours was stored — the duplicate resolved to the winner's row.
    expect(fake.state.inserted).toHaveLength(0);
    expect(fake.state.selectCalls).toBe(2);
  });

  it("re-mints when the duplicate was an api_key collision (no row for the user)", async () => {
    // Duplicate + an empty re-read means the KEY value was taken, not the pair.
    fake.state.insertErrors = [duplicateKeyError()];
    fake.state.rows = [];

    const row = await getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1");
    expect(row?.apiKey).toMatch(KEY_PATTERN);
    // The second attempt landed, and with a different key than the first.
    expect(fake.state.inserted).toHaveLength(1);
    expect(fake.state.inserted[0]).toEqual(row);
    // The initial read plus the duplicate's re-read.
    expect(fake.state.selectCalls).toBe(2);
  });

  it("gives up after the attempt cap instead of looping forever", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // A systematic duplicate error with no readable row: every attempt re-mints.
      fake.state.insertErrors = Array.from({ length: 20 }, duplicateKeyError);
      await expect(getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toBeNull();
      expect(fake.state.insertCalls).toBe(10);
      expect(fake.state.selectCalls).toBe(11);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns null instead of throwing when the insert fails for another reason", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fake.state.insertErrors = [new Error("connection lost")];
      await expect(getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toBeNull();
      // Not retried — only a duplicate key is a retryable outcome.
      expect(fake.state.selectCalls).toBe(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns null instead of throwing when the initial read fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fake.state.selectError = new Error("connection lost");
      await expect(getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toBeNull();
      // A key is never minted on a read that might have hidden an existing one.
      expect(fake.state.insertCalls).toBe(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns null instead of throwing when the duplicate's re-read fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The initial read succeeds; only the read behind the duplicate fails.
      fake.state.selectErrors = [undefined, new Error("connection lost")];
      fake.state.insertErrors = [duplicateKeyError()];
      await expect(getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("never puts a key value in its log lines", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fake.state.insertErrors = [new Error("connection lost")];
      await getOrCreateCodingKey("a1b2c3d4e5", "oid-student-1");
      const logged = errorSpy.mock.calls.flat().join(" ");
      expect(logged).not.toMatch(/nvk-/);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("getStoredCodingKey", () => {
  it("returns the stored row with ONE read and never inserts", async () => {
    const existing = storedRow();
    fake.state.rows = [existing];

    await expect(getStoredCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toEqual({
      status: "found",
      key: existing,
    });
    expect(fake.state.selectCalls).toBe(1);
    expect(fake.state.insertCalls).toBe(0);
  });

  it("reports 'none' — NOT a mint — when the user holds no key for the code", async () => {
    await expect(getStoredCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toEqual({
      status: "none",
    });
    // The whole point of the read-only path: viewing a code attributes nothing.
    expect(fake.state.insertCalls).toBe(0);
  });

  it("keeps a database failure distinct from 'none' so the caller can say so", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fake.state.selectError = new Error("connection lost");
      await expect(getStoredCodingKey("a1b2c3d4e5", "oid-student-1")).resolves.toEqual({
        status: "error",
      });
      expect(fake.state.insertCalls).toBe(0);
      expect(errorSpy.mock.calls.flat().join(" ")).not.toMatch(/nvk-/);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("lookupCodingKey", () => {
  it("resolves a stored key to its (code, userId) pair", async () => {
    fake.state.rows = [{ code: "a1b2c3d4e5", userId: "oid-student-1" }];
    await expect(lookupCodingKey(generateCodingKey())).resolves.toEqual({
      status: "found",
      code: "a1b2c3d4e5",
      userId: "oid-student-1",
    });
  });

  it("misses on an unknown (but well-formed) key", async () => {
    fake.state.rows = [];
    await expect(lookupCodingKey(generateCodingKey())).resolves.toEqual({ status: "miss" });
  });

  // The predicate is the authentication: this lookup is what maps a bearer to
  // the (code, userId) pair the coding routes then trust. Seeding one row and
  // expecting it back cannot catch a dropped WHERE — the fake would hand the
  // same row to a store that selected the whole table — so pin the term itself.
  // Without it, dropping `.where(...)` returns the FIRST key row in the table,
  // i.e. any other student's activity and identity (docs/coding.md).
  it("looks the key up BY the key, not by whatever row comes back first", async () => {
    const apiKey = generateCodingKey();
    fake.state.rows = [{ code: "a1b2c3d4e5", userId: "oid-student-1" }];

    await lookupCodingKey(apiKey);

    expect(fake.state.where).toEqual([eq(codingKeys.apiKey, apiKey)]);
  });

  // The proxy's fast path: junk bearers — an activity code among them — never
  // reach SQL.
  it.each(["", "a1b2c3d4e5", "nvk-", `nvk-${"a".repeat(41)}`, `NVK-${"a".repeat(40)}`])(
    "misses on the malformed key %j without a database round-trip",
    async (key) => {
      fake.state.selectError = new Error("must not be reached");
      await expect(lookupCodingKey(key)).resolves.toEqual({ status: "miss" });
      expect(fake.state.selectCalls).toBe(0);
    },
  );

  it("reports an error (NOT a miss) when the database is down", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fake.state.selectError = new Error("connection lost");
      // A transient outage must stay distinguishable from "no such key" — the
      // route turns this into its retryable 503, not the permanent-sounding 401.
      await expect(lookupCodingKey(generateCodingKey())).resolves.toEqual({ status: "error" });
      // The failing key value must not leak into the log line.
      expect(errorSpy.mock.calls.flat().join(" ")).not.toMatch(/nvk-/);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("listCodingKeys", () => {
  it("carries the display name from the join — null when there is none", async () => {
    const rows = [
      {
        userId: "oid-student-1",
        displayName: "Alex Muster",
        createdAt: new Date("2026-08-20T09:00:00Z"),
      },
      // A user with no `novedu_users` row yet; the page falls back to the oid.
      { userId: "oid-student-2", displayName: null, createdAt: new Date("2026-08-19T09:00:00Z") },
    ];
    fake.state.rows = rows;
    await expect(listCodingKeys("a1b2c3d4e5")).resolves.toEqual(rows);
  });

  it("orders newest issuance first", async () => {
    // The fake doesn't sort — it records the ORDER BY the store asked for.
    await listCodingKeys("a1b2c3d4e5");
    expect(fake.state.order).toEqual([desc(codingKeys.createdAt)]);
  });

  it("returns an empty list instead of throwing when the database is down", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fake.state.selectError = new Error("connection lost");
      await expect(listCodingKeys("a1b2c3d4e5")).resolves.toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("deleteCodingKeysForCodes", () => {
  it("drops the selection's key rows in ONE statement on the given executor", async () => {
    // The bulk delete hands it its transaction handle — same code path either way.
    await deleteCodingKeysForCodes(fake.db as never, ["aaaaaaaaaa", "bbbbbbbbbb"]);
    expect(fake.state.deletedTables).toEqual([codingKeys]);
  });

  it("propagates a database error so the bulk transaction rolls back", async () => {
    const failing = {
      delete: () => ({
        where: async () => {
          throw new Error("connection lost");
        },
      }),
    };
    await expect(deleteCodingKeysForCodes(failing as never, ["aaaaaaaaaa"])).rejects.toThrow(
      "connection lost",
    );
  });
});
