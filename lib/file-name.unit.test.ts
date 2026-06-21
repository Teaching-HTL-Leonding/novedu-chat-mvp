import { describe, expect, it } from "vitest";
import { FILE_NAME_PATTERN, isFileKind, validateFileName } from "@/lib/file-name";

// The pure name/kind helpers are part of the YAML Files API contract (re-exported
// by `@/lib/yaml-files` for the student GUI), so pin their behavior.

describe("validateFileName", () => {
  it("accepts letters, digits, underscore and hyphen (trimming surrounding space)", () => {
    expect(validateFileName("  my-file_1  ")).toEqual({ ok: true, name: "my-file_1" });
  });

  it("rejects spaces, punctuation, emptiness and non-strings", () => {
    for (const bad of ["bad name", "with.dot", "slash/name", "", "   ", 42, null, undefined]) {
      expect(validateFileName(bad as unknown)).toMatchObject({ ok: false });
    }
  });

  it("rejects names longer than 100 characters", () => {
    expect(validateFileName("a".repeat(101))).toMatchObject({ ok: false });
    expect(validateFileName("a".repeat(100))).toEqual({ ok: true, name: "a".repeat(100) });
  });

  it("matches FILE_NAME_PATTERN", () => {
    expect(FILE_NAME_PATTERN.test("ok_name-1")).toBe(true);
    expect(FILE_NAME_PATTERN.test("not ok")).toBe(false);
  });
});

describe("isFileKind", () => {
  it("is true only for 'tutor', 'fragment' or 'quiz'", () => {
    expect(isFileKind("tutor")).toBe(true);
    expect(isFileKind("fragment")).toBe(true);
    expect(isFileKind("quiz")).toBe(true);
    expect(isFileKind("other")).toBe(false);
    expect(isFileKind(undefined)).toBe(false);
  });
});
