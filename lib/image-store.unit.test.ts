// @vitest-environment node
import { asc, desc } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Behaviour-level tests for the temporal IMAGE store: create (insert + name-taken
// guard + the definite/uncertain outcome), the by-name and by-id lookups, and the
// soft-delete transitions — including the invariant that closing a row triggers
// the best-effort object removal OUTSIDE the row transaction. All over a fake
// drizzle handle (no real database) and a mocked filesystem adapter. Mirrors
// `lib/file-store.unit.test.ts`.

const fake = vi.hoisted(() => {
  const state = {
    // What every `select(...).from(...).where(...)` resolves to (the existence
    // check in confirm, the active row in getActive / the delete pre-read, the list).
    rows: [] as Record<string, unknown>[],
    // What the paginated list's COUNT(*) reports, plus every LIMIT/OFFSET window
    // the store asked for (so a test can pin the SQL-side paging).
    total: 0,
    windows: [] as { offset: number; limit: number }[],
    // The ORDER BY terms of the most recent row query, so a test can pin that an
    // explicit sort replaced the default order and the tiebreaker still trails.
    order: [] as unknown[],
    selectError: undefined as unknown,
    inserted: [] as Record<string, unknown>[],
    insertError: undefined as unknown,
    // The node-postgres result shape returned by `update(...).set(...).where(...)`.
    closeResult: { rowCount: 1 } as unknown,
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
  // `.limit(…).offset(…)`; it stays awaitable for the unpaged call.
  const queryTail = (fields?: Record<string, unknown>) => ({
    orderBy: (...order: unknown[]) => {
      state.order = order;
      return {
        limit: (limit: number) => ({
          offset: (offset: number) => {
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
  // `.from(...)` accepts the row query's `.leftJoin(authUsers, …)` (the owner name) as
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

// The adapter seam, plus a log of when each call happened relative to the row
// transaction — the object must only go AFTER the rows are committed.
const storage = vi.hoisted(() => ({ deleteObject: vi.fn(), order: [] as string[] }));

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

vi.mock("@/lib/image-fs", () => ({ deleteObject: storage.deleteObject }));

import { images } from "@/lib/db/schema";
import {
  createImage,
  getActiveImage,
  getActiveImageById,
  listImages,
  softDeleteImages,
} from "@/lib/image-store";

// A duplicate-key (unique constraint) violation as drizzle wraps it: cause chain
// with the Postgres SQLSTATE.
const uniqueViolation = () =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    }),
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
  fake.state.closeResult = { rowCount: 1 };
  fake.state.updateError = undefined;
  storage.order = [];
  storage.deleteObject.mockImplementation(async (key: string) => {
    storage.order.push(`delete:${key}`);
    return { ok: true, existed: true };
  });
});

describe("listImages", () => {
  it("returns the active rows, unpaged, without a COUNT or a LIMIT/OFFSET", async () => {
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

// The by-id lookup the byte route re-runs on EVERY request (including a 304), so
// a closed row stops serving immediately.
describe("getActiveImageById", () => {
  const ID = "11111111-1111-1111-1111-111111111111";

  it("maps the active row's metadata", async () => {
    fake.state.rows = [activeRow()];
    await expect(getActiveImageById(ID)).resolves.toMatchObject({
      id: ID,
      name: "diagram",
      blobPath: "abc.png",
      mimeType: "image/png",
    });
  });

  it("returns null for a closed / unknown id", async () => {
    fake.state.rows = [];
    await expect(getActiveImageById(ID)).resolves.toBeNull();
  });

  it("returns null for a malformed id WITHOUT a DB hit", async () => {
    fake.state.selectError = new Error("must not be reached");
    await expect(getActiveImageById("not-a-uuid")).resolves.toBeNull();
    await expect(getActiveImageById("")).resolves.toBeNull();
    await expect(getActiveImageById(`${ID}' OR 1=1--`)).resolves.toBeNull();
  });

  it("returns undefined on a database error", async () => {
    fake.state.selectError = new Error("down");
    await expect(getActiveImageById(ID)).resolves.toBeUndefined();
  });
});

describe("createImage", () => {
  const input = {
    name: "diagram",
    blobPath: "abc.png",
    mimeType: "image/png",
    byteSize: 1234,
    credit: "CC BY 4.0",
  };

  it("inserts a first active version (with its credit) and returns the new row id", async () => {
    fake.state.rows = []; // no existing active row
    const result = await createImage(input, "teacher-1");
    expect(result).toMatchObject({ ok: true, name: "diagram" });
    expect(fake.state.inserted).toHaveLength(1);
    const inserted = fake.state.inserted[0];
    expect(inserted).toMatchObject({
      name: "diagram",
      blobPath: "abc.png",
      mimeType: "image/png",
      byteSize: 1234,
      credit: "CC BY 4.0",
      createdBy: "teacher-1",
      validUntil: null,
      closedBy: null,
    });
    // The returned id is exactly the row's — it is what the byte URL is built from.
    if (!result.ok) return;
    expect(result.id).toBe(inserted?.id);
  });

  it("rejects with name-taken when an active row already exists (pre-check)", async () => {
    fake.state.rows = [{ id: "existing" }];
    const result = await createImage(input, "teacher-1");
    expect(result).toEqual({ ok: false, reason: "name-taken" });
    expect(fake.state.inserted).toHaveLength(0);
  });

  it("maps a unique-index violation (an insert race) to name-taken", async () => {
    fake.state.rows = [];
    fake.state.insertError = uniqueViolation();
    await expect(createImage(input, "teacher-1")).resolves.toEqual({
      ok: false,
      reason: "name-taken",
    });
  });

  it("reports a DEFINITE outcome for a SQLSTATE failure the server answered", async () => {
    fake.state.rows = [];
    fake.state.insertError = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("value too long"), { code: "22001" }),
    });
    await expect(createImage(input, "teacher-1")).resolves.toEqual({
      ok: false,
      reason: "error",
      outcome: "definite",
    });
  });

  it("reports an UNCERTAIN outcome for a connection failure", async () => {
    fake.state.rows = [];
    fake.state.insertError = new Error("Connection terminated unexpectedly");
    await expect(createImage(input, "teacher-1")).resolves.toEqual({
      ok: false,
      reason: "error",
      outcome: "uncertain",
    });
  });
});

// Bulk soft-delete (the list's "Delete Selected", the only delete path) loops the
// `closeActiveImage` primitive in ONE transaction; the objects are removed
// best-effort AFTER it commits. These pin the count of rows closed, the already-gone
// no-op, the lost conditional-close race, the all-or-nothing rollback, the swallowed
// best-effort storage failure, and the empty-input short-circuit.
describe("softDeleteImages", () => {
  it("closes every named image, counts the closed rows, and deletes each object", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowCount: 1 };
    await expect(softDeleteImages(["a", "b", "c"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 3,
    });
    expect(storage.deleteObject).toHaveBeenCalledTimes(3);
  });

  it("removes the objects only AFTER the row transaction resolves", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowCount: 1 };
    const original = fake.db.transaction;
    const commit = vi
      .spyOn(fake.db, "transaction")
      .mockImplementation(async (cb: Parameters<typeof original>[0]) => {
        storage.order.push("tx:start");
        const result = await original(cb);
        storage.order.push("tx:end");
        return result;
      });

    await softDeleteImages(["a"], "teacher-3");

    // The adapter is untouched until the transaction has resolved.
    expect(storage.order).toEqual(["tx:start", "tx:end", "delete:abc.png"]);
    commit.mockRestore();
  });

  it("keeps { ok: true } when the object was already missing", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowCount: 1 };
    storage.deleteObject.mockResolvedValue({ ok: true, existed: false });
    await expect(softDeleteImages(["diagram"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 1,
    });
  });

  it("treats already-gone names as no-op successes (not counted, no object delete)", async () => {
    fake.state.rows = []; // nothing active to read
    await expect(softDeleteImages(["ghost1", "ghost2"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 0,
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("treats a lost conditional-close race as not counted (no object delete)", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowCount: 0 };
    await expect(softDeleteImages(["diagram"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 0,
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("still succeeds (best-effort) when the object delete fails", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.closeResult = { rowCount: 1 };
    storage.deleteObject.mockResolvedValue({ ok: false, reason: "error", detail: "io" });
    await expect(softDeleteImages(["diagram"], "teacher-3")).resolves.toEqual({
      ok: true,
      deleted: 1,
    });
  });

  it("rolls the whole batch back on a database error (no object delete)", async () => {
    fake.state.rows = [{ blobPath: "abc.png" }];
    fake.state.updateError = new Error("down");
    await expect(softDeleteImages(["a", "b"], "teacher-3")).resolves.toEqual({
      ok: false,
      deleted: 0,
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("short-circuits an empty selection without touching the database or storage", async () => {
    fake.state.updateError = new Error("must not be reached");
    await expect(softDeleteImages([], "teacher-3")).resolves.toEqual({ ok: true, deleted: 0 });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
