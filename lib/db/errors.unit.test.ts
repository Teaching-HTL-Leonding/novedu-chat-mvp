import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "@/lib/db/errors";

// The duplicate-key check every collision branch shares. Postgres reports a
// unique violation as SQLSTATE 23505, and drizzle wraps the driver error, so the
// code usually sits one `cause` down — both shapes must be recognized.

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
