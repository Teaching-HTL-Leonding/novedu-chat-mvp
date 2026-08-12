// @vitest-environment node
import { asc, desc } from "drizzle-orm";
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
    // What the paginated list's COUNT(*) reports, plus every OFFSET/FETCH window
    // the store asked for (so a test can pin the SQL-side paging).
    total: 0,
    windows: [] as { offset: number; limit: number }[],
    // The ORDER BY terms of the most recent row query, so a test can pin that an
    // explicit sort replaced the default order and the tiebreaker still trails.
    order: [] as unknown[],
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
  // returns a builder (not a promise) because the paged list query continues with
  // `.offset(…).fetch(…)`; it stays awaitable for the unpaged call.
  const queryTail = (fields?: Record<string, unknown>) => ({
    orderBy: (...order: unknown[]) => {
      state.order = order;
      return {
        offset: (offset: number) => ({
          fetch: (limit: number) => {
            state.windows.push({ offset, limit });
            return selectRun(fields);
          },
        }),
        // biome-ignore lint/suspicious/noThenProperty: mimicking drizzle's awaitable query builder
        then: (...args: Parameters<Promise<unknown[]>["then"]>) => selectRun(fields).then(...args),
      };
    },
    // biome-ignore lint/suspicious/noThenProperty: mimicking drizzle's awaitable query builder
    then: (...args: Parameters<Promise<unknown[]>["then"]>) => selectRun(fields).then(...args),
  });
  // `.from(...).$dynamic()` is how the shared `countRows` helper applies its joins
  // in a loop; the tail still resolves through `queryTail`.
  const dynamicTail = (fields?: Record<string, unknown>) => {
    const tail = { leftJoin: () => tail, where: () => queryTail(fields) };
    return tail;
  };
  // `.from(...)` accepts the row query's `.leftJoin(users, …)` (the owner name) as
  // well as the count's `$dynamic()`; both tails resolve through `queryTail`.
  const fromTail = (fields?: Record<string, unknown>) => {
    const tail = {
      leftJoin: () => tail,
      where: () => queryTail(fields),
      $dynamic: () => dynamicTail(fields),
    };
    return tail;
  };
  const select = (fields?: Record<string, unknown>) => ({ from: () => fromTail(fields) });
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
    selectDistinct: select,
    insert,
    update,
    transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  };
  return { state, db };
});

const blob = vi.hoisted(() => ({ deleteBlob: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

vi.mock("@/lib/image-blob", () => ({ deleteBlob: blob.deleteBlob }));

import { images } from "@/lib/db/schema";
import { confirmImage, getActiveImage, listImages, softDeleteImages } from "@/lib/image-store";

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
  fake.state.total = 0;
  fake.state.windows = [];
  fake.state.selectError = undefined;
  fake.state.inserted = [];
  fake.state.insertError = undefined;
  fake.state.closeResult = { rowsAffected: [1] };
  fake.state.updateError = undefined;
  blob.deleteBlob.mockResolvedValue(undefined);
});

describe("listImages", () => {
  it("returns the active rows, unpaged, without a COUNT or an OFFSET/FETCH", async () => {
    fake.state.rows = [activeRow()];
    await expect(listImages()).resolves.toEqual({
      rows: [activeRow()],
      total: 1,
      page: 1,
      pageSize: 1,
    });
    expect(fake.state.windows).toEqual([]);
  });

  it("pushes the skip and the limit into SQL and reports the DB-side total", async () => {
    fake.state.rows = [activeRow()];
    fake.state.total = 42;

    const result = await listImages({ paging: { page: 2, pageSize: 20 } });

    expect(fake.state.windows).toEqual([{ offset: 20, limit: 20 }]);
    expect(result).toMatchObject({ total: 42, page: 2, pageSize: 20 });
  });

  it("returns undefined on a database error", async () => {
    fake.state.selectError = new Error("down");
    await expect(listImages()).resolves.toBeUndefined();
  });

  it("lets an explicit sort replace the default order, keeping the tiebreaker last", async () => {
    await listImages({ sort: { key: "size", dir: "desc" } });
    expect(fake.state.order).toEqual([desc(images.byteSize), asc(images.id)]);

    await listImages();
    expect(fake.state.order).toEqual([desc(images.validFrom), asc(images.id)]);
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

// Bulk soft-delete (the list's "Delete Selected", the only delete path) loops the
// `closeActiveImage` primitive in ONE transaction; the blobs are removed
// best-effort AFTER it commits. These pin the count of rows closed, the already-gone
// no-op, the lost conditional-close race, the all-or-nothing rollback, the swallowed
// best-effort blob failure, and the empty-input short-circuit.
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

  it("treats a lost conditional-close race as not counted (no blob delete)", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowsAffected: [0] };
    await expect(softDeleteImages(["diagram"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 0,
    });
    expect(blob.deleteBlob).not.toHaveBeenCalled();
  });

  it("still succeeds (best-effort) when a blob delete throws", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowsAffected: [1] };
    blob.deleteBlob.mockRejectedValue(new Error("blob gone"));
    await expect(softDeleteImages(["diagram"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 1,
    });
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
