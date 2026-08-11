import { beforeEach, describe, expect, it, vi } from "vitest";

// Behavior-level tests for the temporal file store: the create/update/delete
// transitions, the row-count concurrency guard (affectedRows), and name-taken
// detection — all over a fake drizzle handle (no real database). These are the
// fast CI counterpart to the @live e2e lifecycle.

const fake = vi.hoisted(() => {
  const state = {
    // What every `select(...).from(...).where(...)` resolves to (the existence
    // check inside create, the active row inside update/getActiveFile, the list).
    rows: [] as Record<string, unknown>[],
    // What the paginated list's COUNT(*) reports, plus every OFFSET/FETCH window
    // the store asked for (so a test can pin the SQL-side paging).
    total: 0,
    windows: [] as { offset: number; limit: number }[],
    selectError: undefined as unknown,
    inserted: [] as Record<string, unknown>[],
    insertError: undefined as unknown,
    // The mssql IResult shape returned by `update(...).set(...).where(...)`.
    closeResult: { rowsAffected: [1] } as unknown,
    updateError: undefined as unknown,
  };

  // The list's COUNT(*) goes through the same select/from/where chain as its rows,
  // so the fake tells them apart by the projection: `{ n: … }` is the count.
  const selectRun = (fields?: Record<string, unknown>) => {
    if (state.selectError) return Promise.reject(state.selectError);
    const isCount = fields !== undefined && "n" in fields;
    return Promise.resolve(isCount ? [{ n: state.total }] : state.rows);
  };
  // A lazy thenable so error cases only reject when actually awaited. `orderBy`
  // returns a builder (not a promise) because the paged query continues with
  // `.offset(…).fetch(…)`; it stays awaitable for the unpaged call.
  const queryTail = (fields?: Record<string, unknown>) => ({
    orderBy: () => ({
      offset: (offset: number) => ({
        fetch: (limit: number) => {
          state.windows.push({ offset, limit });
          return selectRun(fields);
        },
      }),
      // biome-ignore lint/suspicious/noThenProperty: mimicking drizzle's awaitable query builder
      then: (...args: Parameters<Promise<unknown[]>["then"]>) => selectRun(fields).then(...args),
    }),
    // biome-ignore lint/suspicious/noThenProperty: mimicking drizzle's awaitable query builder
    then: (...args: Parameters<Promise<unknown[]>["then"]>) => selectRun(fields).then(...args),
  });
  // `.from(...).$dynamic()` is how the shared `countRows` helper applies its joins
  // in a loop; the tail still resolves through `queryTail`.
  const dynamicTail = (fields?: Record<string, unknown>) => {
    const tail = { leftJoin: () => tail, where: () => queryTail(fields) };
    return tail;
  };
  const select = (fields?: Record<string, unknown>) => ({
    from: () => ({ where: () => queryTail(fields), $dynamic: () => dynamicTail(fields) }),
  });
  const insert = () => ({
    values: async (values: Record<string, unknown>) => {
      if (state.insertError) throw state.insertError;
      state.inserted.push(values);
    },
  });
  const update = () => ({
    set: () => ({
      where: async () => {
        if (state.updateError) throw state.updateError;
        return state.closeResult;
      },
    }),
  });
  const tx = { select, insert, update };
  const db = {
    select,
    insert,
    update,
    transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  };
  return { state, db };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import {
  createFile,
  getActiveFile,
  listFiles,
  softDeleteFiles,
  updateFile,
} from "@/lib/file-store";

// The pure name/kind helpers (`validateFileName` / `isFileKind`) moved to
// `lib/file-name.ts` and are covered by `lib/file-name.unit.test.ts`; this file
// owns the temporal store transitions only.

// A duplicate-key (unique index) violation as drizzle wraps it: cause chain with
// the mssql error number.
const uniqueViolation = () =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("Violation of UNIQUE KEY constraint"), { number: 2601 }),
  });

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "linked-lists",
    kind: "tutor",
    title: "Linked Lists",
    description: "A tutor about linked lists",
    content: "id: x\n",
    createdBy: "teacher-1",
    validFrom: new Date("2026-06-10T10:00:00Z"),
    createdAt: new Date("2026-06-10T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  fake.state.rows = [];
  fake.state.total = 0;
  fake.state.windows = [];
  fake.state.selectError = undefined;
  fake.state.inserted = [];
  fake.state.insertError = undefined;
  fake.state.closeResult = { rowsAffected: [1] };
  fake.state.updateError = undefined;
});

describe("listFiles", () => {
  it("returns the active rows, unpaged, without a COUNT or an OFFSET/FETCH", async () => {
    fake.state.rows = [activeRow()];
    await expect(listFiles()).resolves.toEqual({
      rows: [activeRow()],
      total: 1,
      page: 1,
      pageSize: 1,
    });
    expect(fake.state.windows).toEqual([]);
  });

  it("pushes the skip and the limit into SQL and reports the DB-side total", async () => {
    fake.state.rows = [activeRow()];
    fake.state.total = 137;

    const result = await listFiles({ paging: { page: 3, pageSize: 20 } });

    expect(fake.state.windows).toEqual([{ offset: 40, limit: 20 }]);
    expect(result).toEqual({ rows: [activeRow()], total: 137, page: 3, pageSize: 20 });
  });

  it("clamps a page past the end onto the last one", async () => {
    // The fake returns the same rows for every window, so drive the over-shoot
    // off an empty first page: total says 25 rows exist, page 9 has none.
    fake.state.rows = [];
    fake.state.total = 25;

    const result = await listFiles({ paging: { page: 9, pageSize: 20 } });

    expect(fake.state.windows).toEqual([
      { offset: 160, limit: 20 },
      { offset: 20, limit: 20 },
    ]);
    expect(result?.page).toBe(2);
  });

  it("returns undefined on a database error", async () => {
    fake.state.selectError = new Error("down");
    await expect(listFiles()).resolves.toBeUndefined();
  });
});

describe("getActiveFile", () => {
  it("maps the active row (with content)", async () => {
    fake.state.rows = [activeRow()];
    const file = await getActiveFile("linked-lists");
    expect(file).toMatchObject({ name: "linked-lists", kind: "tutor", content: "id: x\n" });
  });

  it("returns null for an unknown / soft-deleted name", async () => {
    fake.state.rows = [];
    await expect(getActiveFile("ghost")).resolves.toBeNull();
  });

  it("returns null for a malformed name without a DB hit", async () => {
    fake.state.selectError = new Error("must not be reached");
    await expect(getActiveFile("bad name")).resolves.toBeNull();
  });

  it("returns undefined on a database error", async () => {
    fake.state.selectError = new Error("down");
    await expect(getActiveFile("linked-lists")).resolves.toBeUndefined();
  });
});

describe("createFile", () => {
  const input = {
    name: "linked-lists",
    kind: "tutor" as const,
    content: "id: x\n",
    title: "Linked Lists",
    description: "desc",
  };

  it("inserts a first active version when the name is free", async () => {
    fake.state.rows = []; // no existing active row
    const result = await createFile(input, "teacher-1");
    expect(result).toEqual({ ok: true, name: "linked-lists" });
    expect(fake.state.inserted).toHaveLength(1);
    expect(fake.state.inserted[0]).toMatchObject({
      name: "linked-lists",
      kind: "tutor",
      createdBy: "teacher-1",
      validUntil: null,
      closedBy: null,
    });
  });

  it("rejects with name-taken when an active row already exists (pre-check)", async () => {
    fake.state.rows = [{ id: "existing" }];
    const result = await createFile(input, "teacher-1");
    expect(result).toEqual({ ok: false, reason: "name-taken" });
    expect(fake.state.inserted).toHaveLength(0);
  });

  it("maps a unique-index violation (a create race) to name-taken", async () => {
    fake.state.rows = [];
    fake.state.insertError = uniqueViolation();
    await expect(createFile(input, "teacher-1")).resolves.toEqual({
      ok: false,
      reason: "name-taken",
    });
  });

  it("returns reason:error on a generic database failure", async () => {
    fake.state.rows = [];
    fake.state.insertError = new Error("connection lost");
    await expect(createFile(input, "teacher-1")).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("clamps an over-long title/description to the column widths", async () => {
    fake.state.rows = [];
    await createFile(
      { ...input, title: "T".repeat(600), description: "D".repeat(3000) },
      "teacher-1",
    );
    const row = fake.state.inserted[0] as { title: string; description: string };
    expect(row.title.length).toBe(512);
    expect(row.description.length).toBe(2048);
  });
});

describe("updateFile", () => {
  const input = { content: "id: y\n", title: "t", description: "d" };

  it("closes the active row and inserts a new version, preserving kind", async () => {
    fake.state.rows = [{ id: "v1", kind: "fragment" }];
    fake.state.closeResult = { rowsAffected: [1] };
    const result = await updateFile("linked-lists", input, "teacher-2");
    expect(result).toEqual({ ok: true });
    expect(fake.state.inserted).toHaveLength(1);
    expect(fake.state.inserted[0]).toMatchObject({
      name: "linked-lists",
      kind: "fragment",
      createdBy: "teacher-2",
      validUntil: null,
    });
  });

  it("returns not-found when there is no active row", async () => {
    fake.state.rows = [];
    await expect(updateFile("ghost", input, "teacher-2")).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(fake.state.inserted).toHaveLength(0);
  });

  it("returns not-found when the conditional close affects 0 rows (lost race)", async () => {
    fake.state.rows = [{ id: "v1", kind: "tutor" }];
    fake.state.closeResult = { rowsAffected: [0] };
    await expect(updateFile("linked-lists", input, "teacher-2")).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(fake.state.inserted).toHaveLength(0); // never minted a second active row
  });

  it("returns reason:error on a database failure", async () => {
    fake.state.rows = [{ id: "v1", kind: "tutor" }];
    fake.state.updateError = new Error("down");
    await expect(updateFile("linked-lists", input, "teacher-2")).resolves.toEqual({
      ok: false,
      reason: "error",
    });
  });
});

// Bulk soft-delete (the list's "Delete Selected", the only delete path) loops the
// `closeActiveFile` primitive inside ONE transaction. These pin the batch contract:
// the count of rows actually closed, the already-gone no-op, the `rowsAffected`
// driver-shape robustness, all-or-nothing rollback on a DB error, and the
// empty-input short-circuit.
describe("softDeleteFiles", () => {
  it("closes every named file and counts the rows actually closed", async () => {
    fake.state.closeResult = { rowsAffected: [1] };
    await expect(softDeleteFiles(["a", "b", "c"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 3,
    });
  });

  it("treats already-gone names as no-op successes (not counted), still ok", async () => {
    fake.state.closeResult = { rowsAffected: [0] };
    await expect(softDeleteFiles(["ghost1", "ghost2"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 0,
    });
  });

  it("reads a scalar rowsAffected too (driver-shape robustness)", async () => {
    fake.state.closeResult = { rowsAffected: 1 };
    await expect(softDeleteFiles(["a"], "teacher-3")).resolves.toEqual({ ok: true, deleted: 1 });
  });

  it("treats a missing rowsAffected as 0 (not counted, never a false success)", async () => {
    fake.state.closeResult = {};
    await expect(softDeleteFiles(["a"], "teacher-3")).resolves.toEqual({ ok: true, deleted: 0 });
  });

  it("rolls the whole batch back on a database error (all-or-nothing)", async () => {
    fake.state.updateError = new Error("down");
    await expect(softDeleteFiles(["a", "b"], "teacher-3")).resolves.toEqual({
      ok: false,
      deleted: 0,
    });
  });

  it("short-circuits an empty selection without touching the database", async () => {
    fake.state.updateError = new Error("must not be reached");
    await expect(softDeleteFiles([], "teacher-3")).resolves.toEqual({ ok: true, deleted: 0 });
  });
});
