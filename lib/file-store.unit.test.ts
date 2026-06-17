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
    selectError: undefined as unknown,
    inserted: [] as Record<string, unknown>[],
    insertError: undefined as unknown,
    // The mssql IResult shape returned by `update(...).set(...).where(...)`.
    closeResult: { rowsAffected: [1] } as unknown,
    updateError: undefined as unknown,
  };

  const selectRun = () =>
    state.selectError ? Promise.reject(state.selectError) : Promise.resolve(state.rows);
  // A lazy thenable so error cases only reject when actually awaited.
  const queryTail = () => ({
    orderBy: () => selectRun(),
    // biome-ignore lint/suspicious/noThenProperty: mimicking drizzle's awaitable query builder
    then: (...args: Parameters<Promise<unknown[]>["then"]>) => selectRun().then(...args),
  });
  const select = () => ({ from: () => ({ where: () => queryTail() }) });
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

import { createFile, getActiveFile, listFiles, softDeleteFile, updateFile } from "@/lib/file-store";

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
  fake.state.selectError = undefined;
  fake.state.inserted = [];
  fake.state.insertError = undefined;
  fake.state.closeResult = { rowsAffected: [1] };
  fake.state.updateError = undefined;
});

describe("listFiles", () => {
  it("returns the active rows", async () => {
    fake.state.rows = [activeRow()];
    await expect(listFiles()).resolves.toEqual([activeRow()]);
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
    expect((fake.state.inserted[0]?.title as string).length).toBe(512);
    expect((fake.state.inserted[0]?.description as string).length).toBe(2048);
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

describe("softDeleteFile", () => {
  it("closes the active row (rowsAffected >= 1)", async () => {
    fake.state.closeResult = { rowsAffected: [1] };
    await expect(softDeleteFile("linked-lists", "teacher-3")).resolves.toEqual({ ok: true });
  });

  it("returns not-found when nothing was active to close", async () => {
    fake.state.closeResult = { rowsAffected: [0] };
    await expect(softDeleteFile("ghost", "teacher-3")).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("reads a scalar rowsAffected too (driver-shape robustness)", async () => {
    fake.state.closeResult = { rowsAffected: 1 };
    await expect(softDeleteFile("linked-lists", "teacher-3")).resolves.toEqual({ ok: true });
  });

  it("treats a missing rowsAffected as 0 (not-found, never a false success)", async () => {
    fake.state.closeResult = {};
    await expect(softDeleteFile("linked-lists", "teacher-3")).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("returns reason:error on a database failure", async () => {
    fake.state.updateError = new Error("down");
    await expect(softDeleteFile("linked-lists", "teacher-3")).resolves.toEqual({
      ok: false,
      reason: "error",
    });
  });
});
