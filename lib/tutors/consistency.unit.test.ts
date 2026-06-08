import { describe, expect, it } from "vitest";
import { checkConsistency } from "./consistency";
import type { Fragment, FragmentFile, Tutor } from "./schemas";
import { loadRealFragmentFiles, loadRealTutor } from "./test-fixtures";

// Each test starts from the real, self-consistent sample and mutates a clone to
// trigger exactly one error/warning category.
function fresh(): { tutor: Tutor; files: Map<string, FragmentFile> } {
  return { tutor: loadRealTutor(), files: loadRealFragmentFiles() };
}

function codes(result: { errors: { code: string }[] }): string[] {
  return result.errors.map((e) => e.code);
}

describe("checkConsistency — happy path", () => {
  it("accepts the real sample with no errors", () => {
    const { tutor, files } = fresh();
    const result = checkConsistency(tutor, files);
    expect(result.errors).toEqual([]);
  });

  it("produces a plan ordered by priority", () => {
    const { tutor, files } = fresh();
    const result = checkConsistency(tutor, files);
    expect(result.plan.map((p) => p.priority)).toEqual([
      100, 120, 140, 200, 220, 240, 300, 320, 400, 500, 520, 900,
    ]);
  });
});

describe("checkConsistency — errors", () => {
  it("UNKNOWN_FRAGMENT_FILE_ALIAS for a bad file alias", () => {
    const { tutor, files } = fresh();
    const [first] = tutor.prompt.fragments;
    if (first) first.file = "does_not_exist";
    expect(codes(checkConsistency(tutor, files))).toContain("UNKNOWN_FRAGMENT_FILE_ALIAS");
  });

  it("FRAGMENT_NOT_FOUND for a bad fragment id", () => {
    const { tutor, files } = fresh();
    const [first] = tutor.prompt.fragments;
    if (first) first.id = "no_such_fragment";
    expect(codes(checkConsistency(tutor, files))).toContain("FRAGMENT_NOT_FOUND");
  });

  it("MISSING_REQUIRED_VARIABLE when a required input is absent", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "socratic_tutor");
    delete ref?.variables?.domain;
    const result = checkConsistency(tutor, files);
    expect(codes(result)).toContain("MISSING_REQUIRED_VARIABLE");
    expect(result.errors.find((e) => e.code === "MISSING_REQUIRED_VARIABLE")?.variable).toBe(
      "domain",
    );
  });

  it("MISSING_REQUIRED_VARIABLE when only bind (no variables) satisfies the input", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "socratic_tutor");
    if (ref) {
      ref.variables = {};
      ref.bind = { domain: "topic.domain" };
    }
    expect(codes(checkConsistency(tutor, files))).toContain("MISSING_REQUIRED_VARIABLE");
  });

  it("VARIABLE_TYPE_MISMATCH: array where string expected", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "socratic_tutor");
    if (ref?.variables) ref.variables.domain = ["not", "a", "string"];
    expect(codes(checkConsistency(tutor, files))).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("VARIABLE_TYPE_MISMATCH: string where boolean expected", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "exercise_generation");
    if (ref?.variables) ref.variables.allow_solution = "false";
    expect(codes(checkConsistency(tutor, files))).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("VARIABLE_TYPE_MISMATCH: string where array expected", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "no_full_solutions");
    if (ref?.variables) ref.variables.forbidden_outputs = "oops" as unknown as string[];
    expect(codes(checkConsistency(tutor, files))).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("DUPLICATE_PRIORITY when two referenced fragments share a priority", () => {
    const { tutor, files } = fresh();
    const general = files.get("general_fragments");
    const a = general?.fragments.find((f: Fragment) => f.id === "socratic_tutor");
    const b = general?.fragments.find((f: Fragment) => f.id === "no_full_solutions");
    if (a && b) b.priority = a.priority;
    expect(codes(checkConsistency(tutor, files))).toContain("DUPLICATE_PRIORITY");
  });

  it("DUPLICATE_FRAGMENT_FILE_ALIAS when an alias is declared twice", () => {
    const { tutor, files } = fresh();
    const [firstFile] = tutor.prompt.fragment_files;
    if (firstFile) tutor.prompt.fragment_files.push({ ...firstFile });
    expect(codes(checkConsistency(tutor, files))).toContain("DUPLICATE_FRAGMENT_FILE_ALIAS");
  });

  it("DUPLICATE_FRAGMENT_ID_IN_FILE when a file declares a fragment twice", () => {
    const { tutor, files } = fresh();
    const general = files.get("general_fragments");
    const firstFragment = general?.fragments[0];
    if (general && firstFragment) general.fragments.push({ ...firstFragment });
    expect(codes(checkConsistency(tutor, files))).toContain("DUPLICATE_FRAGMENT_ID_IN_FILE");
  });
});

describe("checkConsistency — warnings", () => {
  it("UNDECLARED_VARIABLE for an extra supplied variable", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "socratic_tutor");
    if (ref?.variables) ref.variables.surprise = "x";
    const result = checkConsistency(tutor, files);
    expect(result.warnings.map((w) => w.code)).toContain("UNDECLARED_VARIABLE");
    expect(result.errors).toEqual([]);
  });

  it("DUPLICATE_FRAGMENT_REFERENCE when the same fragment is referenced twice", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "linked_lists_visualization");
    if (ref) tutor.prompt.fragments.push({ ...ref });
    const result = checkConsistency(tutor, files);
    expect(result.warnings.map((w) => w.code)).toContain("DUPLICATE_FRAGMENT_REFERENCE");
  });
});
