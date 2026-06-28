import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake drizzle handle: just enough of the fluent query API for the store's
// operations. Behavior-level tests — what rows come back / what gets inserted —
// not SQL-text assertions.
const fake = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    inserted: [] as Record<string, unknown>[],
    insertErrors: [] as unknown[],
    selectError: undefined as unknown,
    deleteCalls: 0,
    deleteError: undefined as unknown,
    updated: [] as Record<string, unknown>[],
    updateError: undefined as unknown,
    updateRowsAffected: [1] as number[],
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
  const select = () => ({ from: () => ({ where: () => queryTail() }) });
  const insert = () => ({
    values: async (values: Record<string, unknown>) => {
      const error = state.insertErrors.shift();
      if (error) throw error;
      state.inserted.push(values);
    },
  });
  const del = () => ({
    where: async () => {
      state.deleteCalls += 1;
      if (state.deleteError) throw state.deleteError;
    },
  });
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        if (state.updateError) throw state.updateError;
        state.updated.push(values);
        return { rowsAffected: state.updateRowsAffected };
      },
    }),
  });
  return { state, db: { select, insert, delete: del, update } };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import {
  CODE_PATTERN,
  type CodeEntry,
  checkCode,
  createCode,
  generateCode,
  getCode,
  listCodes,
  MAX_NOTE_LENGTH,
  updateCode,
  validateCodeRequest,
} from "@/lib/code-store";

const NOW = new Date("2026-06-10T12:00:00Z");

function entry(overrides: Partial<CodeEntry> = {}): CodeEntry {
  return {
    code: "a1b2c3d4e5",
    module: "tutor",
    createdBy: "teacher-sub-1",
    fileUrl: "https://example.com/tutor.yaml",
    validFrom: new Date("2026-06-10T10:00:00Z"),
    validUntil: new Date("2026-06-10T14:00:00Z"),
    note: "",
    origin: null,
    anonymous: true,
    createdAt: new Date("2026-06-09T09:00:00Z"),
    ...overrides,
  };
}

// mssql duplicate-key errors arrive wrapped (DrizzleQueryError → cause chain).
const duplicateKeyError = () =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("Violation of PRIMARY KEY constraint"), { number: 2627 }),
  });

beforeEach(() => {
  fake.state.rows = [];
  fake.state.inserted = [];
  fake.state.insertErrors = [];
  fake.state.selectError = undefined;
  fake.state.deleteCalls = 0;
  fake.state.deleteError = undefined;
  fake.state.updated = [];
  fake.state.updateError = undefined;
  fake.state.updateRowsAffected = [1];
});

describe("generateCode", () => {
  it("produces 10 lowercase letters/digits (a subset of CODE_PATTERN)", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[a-z0-9]{10}$/);
      expect(code).toMatch(CODE_PATTERN);
    }
  });
});

describe("CODE_PATTERN", () => {
  it("admits memorable codes (hyphens, varied length) but rejects junk", () => {
    expect("bio101").toMatch(CODE_PATTERN);
    expect("a-b-c").toMatch(CODE_PATTERN);
    expect("UPPER").not.toMatch(CODE_PATTERN);
    expect("has space").not.toMatch(CODE_PATTERN);
    expect("x".repeat(33)).not.toMatch(CODE_PATTERN);
  });
});

describe("validateCodeRequest", () => {
  const valid = {
    file: "https://example.com/tutor.yaml",
    start: "1700000000",
    end: "1700003600",
    note: "  My class  ",
  };

  it("accepts a valid request, normalizing the URL and trimming the note", () => {
    const result = validateCodeRequest(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.fileUrl).toBe("https://example.com/tutor.yaml");
      expect(result.payload.validFrom).toEqual(new Date(1_700_000_000 * 1000));
      expect(result.payload.validUntil).toEqual(new Date(1_700_003_600 * 1000));
      expect(result.payload.note).toBe("My class");
    }
  });

  it("normalizes the file URL to URL.href (e.g. percent-encoding)", () => {
    const result = validateCodeRequest({ ...valid, file: " https://example.com/tütor.yaml " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.fileUrl).toBe("https://example.com/t%C3%BCtor.yaml");
  });

  it("treats a missing note as empty", () => {
    const result = validateCodeRequest({ ...valid, note: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.note).toBe("");
  });

  it("rejects an over-long note", () => {
    const result = validateCodeRequest({ ...valid, note: "x".repeat(MAX_NOTE_LENGTH + 1) });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("200") });
  });

  it.each([
    "not a url",
    "ftp://example.com/t.yaml",
    "",
    undefined,
  ])("rejects file input %j", (file) => {
    expect(validateCodeRequest({ ...valid, file }).ok).toBe(false);
  });

  it("rejects a supplied timestamp that is non-numeric", () => {
    expect(validateCodeRequest({ ...valid, start: "12abc" }).ok).toBe(false);
    expect(validateCodeRequest({ ...valid, end: "12abc" }).ok).toBe(false);
  });

  it("rejects a window that ends before (or at) its start", () => {
    const result = validateCodeRequest({ ...valid, end: valid.start });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/after its start/) });
  });

  it("accepts a blank start as an open (null) lower bound", () => {
    const result = validateCodeRequest({ ...valid, start: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.validFrom).toBeNull();
      expect(result.payload.validUntil).toEqual(new Date(1_700_003_600 * 1000));
    }
  });

  it("accepts a blank end as an open (null) upper bound", () => {
    const result = validateCodeRequest({ ...valid, end: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.validFrom).toEqual(new Date(1_700_000_000 * 1000));
      expect(result.payload.validUntil).toBeNull();
    }
  });

  it("accepts both bounds blank as an always-valid (null/null) window", () => {
    const result = validateCodeRequest({ ...valid, start: "", end: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.validFrom).toBeNull();
      expect(result.payload.validUntil).toBeNull();
    }
  });
});

describe("createCode", () => {
  const data = {
    module: "quiz" as const,
    fileUrl: "https://example.com/quiz.yaml",
    validFrom: new Date("2026-06-10T10:00:00Z"),
    validUntil: new Date("2026-06-10T14:00:00Z"),
    note: "My class",
    origin: "http://localhost:3000",
    anonymous: false,
  };

  it("stores the row under the creating teacher and returns the code", async () => {
    const result = await createCode("teacher-sub-1", data);
    expect(result.stored).toBe(true);
    if (result.stored) expect(result.code).toMatch(/^[a-z0-9]{10}$/);
    expect(fake.state.inserted).toHaveLength(1);
    expect(fake.state.inserted[0]).toMatchObject({
      module: "quiz",
      createdBy: "teacher-sub-1",
      fileUrl: data.fileUrl,
      validFrom: data.validFrom,
      validUntil: data.validUntil,
      note: "My class",
      origin: "http://localhost:3000",
      // The activity's anonymity flag is frozen onto the row at create time.
      anonymous: false,
    });
    expect(fake.state.inserted[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("retries with a fresh code on a duplicate-key error", async () => {
    fake.state.insertErrors = [duplicateKeyError()];
    const result = await createCode("teacher-sub-1", data);
    expect(result.stored).toBe(true);
    expect(fake.state.inserted).toHaveLength(1); // second attempt landed
  });

  it("returns { stored: false } instead of throwing on other database errors", async () => {
    fake.state.insertErrors = [new Error("connection lost")];
    await expect(createCode("teacher-sub-1", data)).resolves.toEqual({ stored: false });
  });
});

describe("checkCode", () => {
  it("rejects malformed codes without a database round-trip", async () => {
    fake.state.selectError = new Error("must not be reached");
    await expect(checkCode("NOT_A_CODE", NOW)).resolves.toEqual({
      ok: false,
      reason: "unknown-code",
    });
  });

  it("reports unknown-code when no row matches", async () => {
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({
      ok: false,
      reason: "unknown-code",
    });
  });

  it("accepts a code whose window contains now (bounds inclusive)", async () => {
    const row = entry({ validFrom: NOW, validUntil: NOW });
    fake.state.rows = [row];
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({ ok: true, entry: row });
  });

  it("reports not-started carrying only the start bound", async () => {
    const row = entry({ validFrom: new Date(NOW.getTime() + 1000) });
    fake.state.rows = [row];
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({
      ok: false,
      reason: "not-started",
      validFrom: row.validFrom,
    });
  });

  it("reports expired carrying only the end bound", async () => {
    const row = entry({ validUntil: new Date(NOW.getTime() - 1000) });
    fake.state.rows = [row];
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({
      ok: false,
      reason: "expired",
      validUntil: row.validUntil,
    });
  });

  it("treats a null start as open: never not-started, even before the end", async () => {
    const row = entry({ validFrom: null, validUntil: new Date(NOW.getTime() + 1000) });
    fake.state.rows = [row];
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({ ok: true, entry: row });
  });

  it("treats a null end as open: never expired, even after the start", async () => {
    const row = entry({ validFrom: new Date(NOW.getTime() - 1000), validUntil: null });
    fake.state.rows = [row];
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({ ok: true, entry: row });
  });

  it("accepts an always-valid code (both bounds null)", async () => {
    const row = entry({ validFrom: null, validUntil: null });
    fake.state.rows = [row];
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({ ok: true, entry: row });
  });

  it("reports lookup-failed instead of throwing when the database is down", async () => {
    fake.state.selectError = new Error("connection lost");
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({
      ok: false,
      reason: "lookup-failed",
    });
  });
});

describe("listCodes", () => {
  it("returns all rows (no createdBy filter when none is given)", async () => {
    const rows = [entry(), entry({ code: "f6g7h8i9j0", createdBy: "another-teacher" })];
    fake.state.rows = rows;
    await expect(listCodes()).resolves.toEqual(rows);
  });

  it("returns the rows the fake db yields when filters are supplied", async () => {
    // The fake doesn't execute SQL — it just confirms the call shape resolves to
    // the configured rows (the WHERE/LIKE itself is covered by the @live e2e).
    const rows = [entry({ note: "linked lists" })];
    fake.state.rows = rows;
    await expect(
      listCodes({ search: "linked", createdBy: "teacher-sub-1", module: "tutor" }),
    ).resolves.toEqual(rows);
  });

  it("returns undefined instead of throwing when the database is down", async () => {
    fake.state.selectError = new Error("connection lost");
    await expect(listCodes()).resolves.toBeUndefined();
  });
});

describe("getCode", () => {
  it("returns the row regardless of who created it (no ownership check)", async () => {
    const row = entry({ createdBy: "another-teacher" });
    fake.state.rows = [row];
    await expect(getCode("a1b2c3d4e5")).resolves.toEqual(row);
  });

  it("returns null for an unknown code", async () => {
    fake.state.rows = [];
    await expect(getCode("a1b2c3d4e5")).resolves.toBeNull();
  });

  it("rejects a malformed code without a database round-trip", async () => {
    fake.state.selectError = new Error("must not be reached");
    await expect(getCode("NOT A CODE")).resolves.toBeNull();
  });

  it("returns undefined instead of throwing when the database is down", async () => {
    fake.state.selectError = new Error("connection lost");
    await expect(getCode("a1b2c3d4e5")).resolves.toBeUndefined();
  });
});

describe("unknown module (forward-compat / corrupt row)", () => {
  // A row whose module is not a known CodeModule — e.g. a module written to the DB
  // before its registry entry exists, or a corrupt row. The store treats it as
  // ABSENT so no consumer ever indexes the module registry with an unknown key.
  const unknownRow = { ...entry(), module: "future-module" } as unknown as CodeEntry;

  it("checkCode reports unknown-code (never a half-built entry)", async () => {
    fake.state.rows = [unknownRow];
    await expect(checkCode("a1b2c3d4e5", NOW)).resolves.toEqual({
      ok: false,
      reason: "unknown-code",
    });
  });

  it("getCode returns null", async () => {
    fake.state.rows = [unknownRow];
    await expect(getCode("a1b2c3d4e5")).resolves.toBeNull();
  });

  it("listCodes drops the row instead of yielding an unknown module", async () => {
    fake.state.rows = [entry(), unknownRow, entry({ code: "f6g7h8i9j0" })];
    const result = await listCodes();
    expect(result).toHaveLength(2);
    expect(result?.every((e) => e.module === "tutor")).toBe(true);
  });
});

describe("updateCode", () => {
  const data = {
    validFrom: new Date("2026-07-01T08:00:00Z"),
    validUntil: new Date("2026-07-01T10:00:00Z"),
    note: "edited",
  };

  it("updates only the window + note (never the url/anonymous/createdBy)", async () => {
    await expect(updateCode("a1b2c3d4e5", data)).resolves.toEqual({ ok: true });
    expect(fake.state.updated).toHaveLength(1);
    expect(fake.state.updated[0]).toEqual({
      validFrom: data.validFrom,
      validUntil: data.validUntil,
      note: "edited",
    });
  });

  it("reports not-found for a malformed code without a database round-trip", async () => {
    fake.state.updateError = new Error("must not be reached");
    await expect(updateCode("NOT A CODE", data)).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("reports not-found when no row was affected", async () => {
    fake.state.updateRowsAffected = [0];
    await expect(updateCode("a1b2c3d4e5", data)).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("reports an error instead of throwing when the database is down", async () => {
    fake.state.updateError = new Error("connection lost");
    await expect(updateCode("a1b2c3d4e5", data)).resolves.toEqual({
      ok: false,
      reason: "error",
    });
  });
});
