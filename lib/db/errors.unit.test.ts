import { describe, expect, it } from "vitest";
import { classifyDbFailure, isUniqueViolation, sqlState } from "@/lib/db/errors";

// The duplicate-key check every collision branch shares. Postgres reports a
// unique violation as SQLSTATE 23505, and drizzle wraps the driver error, so the
// code usually sits one `cause` down — both shapes must be recognized.
//
// The same walk answers the second question the image upload asks: did the
// server DECIDE the insert's fate (compensating delete allowed) or not
// (leave the object alone)?

function pgError(code: string): Error {
  return Object.assign(new Error("duplicate key value violates unique constraint"), { code });
}

describe("isUniqueViolation", () => {
  it("recognizes a top-level 23505", () => {
    expect(isUniqueViolation(pgError("23505"))).toBe(true);
  });

  it("recognizes 23505 nested under `cause` (the drizzle wrapper shape)", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: pgError("23505") });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("recognizes 23505 several `cause` levels down", () => {
    const deep = { cause: { cause: { cause: pgError("23505") } } };
    expect(isUniqueViolation(deep)).toBe(true);
  });

  it("rejects any other SQLSTATE", () => {
    expect(isUniqueViolation(pgError("23503"))).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error("nope"), { cause: pgError("42501") }))).toBe(
      false,
    );
  });

  it("rejects non-object values", () => {
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("survives a self-referencing cause chain (depth cap)", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
  });
});

describe("sqlState", () => {
  it("reads a top-level SQLSTATE", () => {
    expect(sqlState(pgError("23505"))).toBe("23505");
  });

  it("reads a SQLSTATE nested under `cause` (the drizzle wrapper shape)", () => {
    expect(sqlState(Object.assign(new Error("Failed query"), { cause: pgError("40001") }))).toBe(
      "40001",
    );
  });

  it("returns null when no SQLSTATE is present", () => {
    expect(sqlState(new Error("Connection terminated unexpectedly"))).toBeNull();
    expect(sqlState(undefined)).toBeNull();
    expect(sqlState("23505")).toBeNull();
  });

  it("never mistakes a five-character node errno for a SQLSTATE", () => {
    // `EPIPE` is five uppercase characters, but `EP` is no Postgres class — and
    // reading it as one would turn a broken socket into a decided transaction.
    expect(sqlState(pgError("EPIPE"))).toBeNull();
    expect(sqlState(pgError("ECONNRESET"))).toBeNull();
    expect(sqlState(pgError("ETIMEDOUT"))).toBeNull();
  });

  it("survives a self-referencing cause chain (depth cap)", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(sqlState(cyclic)).toBeNull();
  });
});

describe("classifyDbFailure", () => {
  it.each([
    ["22001", "string data right truncation"],
    ["23505", "unique violation"],
    ["23502", "not-null violation"],
    ["40001", "serialization failure"],
    ["42601", "syntax error"],
    ["53100", "disk full"],
    ["57014", "query canceled"],
    ["58030", "io error"],
  ])("treats SQLSTATE %s (%s) as definite", (code) => {
    expect(classifyDbFailure(pgError(code))).toBe("definite");
    expect(
      classifyDbFailure(Object.assign(new Error("Failed query"), { cause: pgError(code) })),
    ).toBe("definite");
  });

  it.each([
    ["08000", "connection exception"],
    ["08003", "connection does not exist"],
    ["08006", "connection failure"],
    ["08001", "sqlclient unable to establish connection"],
  ])("treats connection-exception SQLSTATE %s (%s) as uncertain", (code) => {
    expect(classifyDbFailure(pgError(code))).toBe("uncertain");
  });

  it("treats a socket failure with no SQLSTATE as uncertain", () => {
    expect(classifyDbFailure(pgError("ECONNRESET"))).toBe("uncertain");
    expect(classifyDbFailure(new Error("Connection terminated unexpectedly"))).toBe("uncertain");
    expect(classifyDbFailure(new Error("timeout exceeded when trying to connect"))).toBe(
      "uncertain",
    );
    expect(classifyDbFailure(undefined)).toBe("uncertain");
  });
});
