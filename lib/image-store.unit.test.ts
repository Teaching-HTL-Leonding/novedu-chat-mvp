// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Behaviour-level tests for the temporal IMAGE store: confirm (insert + name-taken
// guard), list/getActive mapping, and the soft-delete transitions — including the
// invariant that closing a row triggers the best-effort blob removal OUTSIDE the
// row transaction. All over a fake drizzle handle (no real database) and a mocked
// blob seam. Mirrors `lib/file-store.unit.test.ts`.

const fake = vi.hoisted(() => {
  const state = {
    // What every `select(...).from(...).where(...)` resolves to (the existence
    // check in confirm, the active row in getActive / the delete pre-read, the list).
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
  // A lazy thenable so error cases only reject when actually awaited, and the
  // builder still supports a trailing `.orderBy(...)` (the list query).
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

const blob = vi.hoisted(() => ({ deleteBlob: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));
vi.mock("@/lib/image-blob", () => ({ deleteBlob: blob.deleteBlob }));

import {
  confirmImage,
  getActiveImage,
  listImages,
  softDeleteImage,
  softDeleteImages,
} from "@/lib/image-store";

// A duplicate-key (unique index) violation as drizzle wraps it: cause chain with
// the mssql error number.
const uniqueViolation = () =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("Violation of UNIQUE KEY constraint"), { number: 2601 }),
  });

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "diagram",
    blobPath: "abc.png",
    mimeType: "image/png",
    byteSize: 1234,
    credit: "CC BY 4.0",
    validFrom: new Date("2026-06-10T10:00:00Z"),
    createdBy: "teacher-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.state.rows = [];
  fake.state.selectError = undefined;
  fake.state.inserted = [];
  fake.state.insertError = undefined;
  fake.state.closeResult = { rowsAffected: [1] };
  fake.state.updateError = undefined;
  blob.deleteBlob.mockResolvedValue(undefined);
});

describe("listImages", () => {
  it("returns the active rows", async () => {
    fake.state.rows = [activeRow()];
    await expect(listImages()).resolves.toEqual([activeRow()]);
  });

  it("returns undefined on a database error", async () => {
    fake.state.selectError = new Error("down");
    await expect(listImages()).resolves.toBeUndefined();
  });
});

describe("getActiveImage", () => {
  it("maps the active row's metadata", async () => {
    fake.state.rows = [activeRow()];
    await expect(getActiveImage("diagram")).resolves.toMatchObject({
      name: "diagram",
      blobPath: "abc.png",
      mimeType: "image/png",
      byteSize: 1234,
      credit: "CC BY 4.0",
    });
  });

  it("returns null for an unknown / soft-deleted name", async () => {
    fake.state.rows = [];
    await expect(getActiveImage("ghost")).resolves.toBeNull();
  });

  it("returns null for a malformed name without a DB hit", async () => {
    fake.state.selectError = new Error("must not be reached");
    await expect(getActiveImage("bad name")).resolves.toBeNull();
  });

  it("returns undefined on a database error", async () => {
    fake.state.selectError = new Error("down");
    await expect(getActiveImage("diagram")).resolves.toBeUndefined();
  });
});

describe("confirmImage", () => {
  const input = {
    name: "diagram",
    blobPath: "abc.png",
    mimeType: "image/png",
    byteSize: 1234,
    credit: "CC BY 4.0",
  };

  it("inserts a first active version (with its credit) when the name is free", async () => {
    fake.state.rows = []; // no existing active row
    const result = await confirmImage(input, "teacher-1");
    expect(result).toEqual({ ok: true, name: "diagram" });
    expect(fake.state.inserted).toHaveLength(1);
    expect(fake.state.inserted[0]).toMatchObject({
      name: "diagram",
      blobPath: "abc.png",
      mimeType: "image/png",
      byteSize: 1234,
      credit: "CC BY 4.0",
      createdBy: "teacher-1",
      validUntil: null,
      closedBy: null,
    });
  });

  it("rejects with name-taken when an active row already exists (pre-check)", async () => {
    fake.state.rows = [{ id: "existing" }];
    const result = await confirmImage(input, "teacher-1");
    expect(result).toEqual({ ok: false, reason: "name-taken" });
    expect(fake.state.inserted).toHaveLength(0);
  });

  it("maps a unique-index violation (a confirm race) to name-taken", async () => {
    fake.state.rows = [];
    fake.state.insertError = uniqueViolation();
    await expect(confirmImage(input, "teacher-1")).resolves.toEqual({
      ok: false,
      reason: "name-taken",
    });
  });

  it("returns reason:error on a generic database failure", async () => {
    fake.state.rows = [];
    fake.state.insertError = new Error("connection lost");
    await expect(confirmImage(input, "teacher-1")).resolves.toEqual({ ok: false, reason: "error" });
  });
});

describe("softDeleteImage", () => {
  it("closes the active row and deletes the backing blob (outside the tx)", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowsAffected: [1] };
    await expect(softDeleteImage("diagram", "teacher-3")).resolves.toEqual({ ok: true });
    expect(blob.deleteBlob).toHaveBeenCalledWith("abc.png");
  });

  it("returns not-found and never deletes a blob when nothing was active", async () => {
    fake.state.rows = [];
    await expect(softDeleteImage("ghost", "teacher-3")).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(blob.deleteBlob).not.toHaveBeenCalled();
  });

  it("treats a lost conditional-close race as not-found (no blob delete)", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowsAffected: [0] };
    await expect(softDeleteImage("diagram", "teacher-3")).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(blob.deleteBlob).not.toHaveBeenCalled();
  });

  it("returns reason:error on a database failure (no blob delete)", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.updateError = new Error("down");
    await expect(softDeleteImage("diagram", "teacher-3")).resolves.toEqual({
      ok: false,
      reason: "error",
    });
    expect(blob.deleteBlob).not.toHaveBeenCalled();
  });

  it("still reports success when the best-effort blob delete throws", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    blob.deleteBlob.mockRejectedValue(new Error("blob gone"));
    await expect(softDeleteImage("diagram", "teacher-3")).resolves.toEqual({ ok: true });
  });
});

// Bulk soft-delete reuses the SAME `closeActiveImage` primitive, looped in ONE
// transaction; the blobs are removed best-effort AFTER it commits. These pin the
// count of rows closed, the already-gone no-op, the all-or-nothing rollback, and
// the empty-input short-circuit.
describe("softDeleteImages", () => {
  it("closes every named image, counts the closed rows, and deletes each blob", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowsAffected: [1] };
    await expect(softDeleteImages(["a", "b", "c"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 3,
    });
    expect(blob.deleteBlob).toHaveBeenCalledTimes(3);
  });

  it("treats already-gone names as no-op successes (not counted, no blob delete)", async () => {
    fake.state.rows = []; // nothing active to read
    await expect(softDeleteImages(["ghost1", "ghost2"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 0,
    });
    expect(blob.deleteBlob).not.toHaveBeenCalled();
  });

  it("rolls the whole batch back on a database error (no blob delete)", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.updateError = new Error("down");
    await expect(softDeleteImages(["a", "b"], "teacher-3")).resolves.toEqual({
      ok: false,
      deleted: 0,
    });
    expect(blob.deleteBlob).not.toHaveBeenCalled();
  });

  it("short-circuits an empty selection without touching the database or blobs", async () => {
    fake.state.updateError = new Error("must not be reached");
    await expect(softDeleteImages([], "teacher-3")).resolves.toEqual({ ok: true, deleted: 0 });
    expect(blob.deleteBlob).not.toHaveBeenCalled();
  });
});
