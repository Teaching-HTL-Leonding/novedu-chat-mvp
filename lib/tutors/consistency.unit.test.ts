import { describe, expect, it } from "vitest";
import { checkConsistency, type Fragment, type FragmentFile } from "@/lib/prompt-fragments";
import type { Tutor } from "./schemas";
import { loadFixtureFragmentFiles, loadFixtureTutor } from "./test-fixtures";

// Each test starts from the synthetic, self-consistent fixture and mutates a clone
// to trigger exactly one error/warning category.
function fresh(): { tutor: Tutor; files: Map<string, FragmentFile> } {
  return { tutor: loadFixtureTutor(), files: loadFixtureFragmentFiles() };
}

function codes(result: { errors: { code: string }[] }): string[] {
  return result.errors.map((e) => e.code);
}

describe("checkConsistency — happy path", () => {
  it("accepts the synthetic fixture with no errors", () => {
    const { tutor, files } = fresh();
    const result = checkConsistency(tutor.prompt, files);
    expect(result.errors).toEqual([]);
  });

  it("produces a plan ordered by priority", () => {
    const { tutor, files } = fresh();
    const result = checkConsistency(tutor.prompt, files);
    expect(result.plan.map((p) => p.priority)).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe("checkConsistency — errors", () => {
  it("UNKNOWN_FRAGMENT_FILE_ALIAS for a bad file alias", () => {
    const { tutor, files } = fresh();
    const [first] = tutor.prompt.fragments;
    if (first) first.file = "does_not_exist";
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("UNKNOWN_FRAGMENT_FILE_ALIAS");
  });

  it("FRAGMENT_NOT_FOUND for a bad fragment id", () => {
    const { tutor, files } = fresh();
    const [first] = tutor.prompt.fragments;
    if (first) first.id = "no_such_fragment";
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("FRAGMENT_NOT_FOUND");
  });

  it("MISSING_REQUIRED_VARIABLE when a required input is absent", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "str_frag");
    delete ref?.variables?.topic;
    const result = checkConsistency(tutor.prompt, files);
    expect(codes(result)).toContain("MISSING_REQUIRED_VARIABLE");
    expect(result.errors.find((e) => e.code === "MISSING_REQUIRED_VARIABLE")?.variable).toBe(
      "topic",
    );
  });

  it("MISSING_REQUIRED_VARIABLE when only bind (no variables) satisfies the input", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "str_frag");
    if (ref) {
      ref.variables = {};
      ref.bind = { topic: "context.topic" };
    }
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("MISSING_REQUIRED_VARIABLE");
  });

  it("VARIABLE_TYPE_MISMATCH: array where string expected", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "str_frag");
    if (ref?.variables) ref.variables.topic = ["not", "a", "string"];
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("VARIABLE_TYPE_MISMATCH: string where boolean expected", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "flag_frag");
    if (ref?.variables) ref.variables.enabled = "false";
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("VARIABLE_TYPE_MISMATCH: string where array expected", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "list_frag");
    if (ref?.variables) ref.variables.items = "oops" as unknown as string[];
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("DUPLICATE_PRIORITY when two referenced fragments share a priority", () => {
    const { tutor, files } = fresh();
    const libA = files.get("lib_a");
    const a = libA?.fragments.find((f: Fragment) => f.id === "str_frag");
    const b = libA?.fragments.find((f: Fragment) => f.id === "list_frag");
    if (a && b) b.priority = a.priority;
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("DUPLICATE_PRIORITY");
  });

  it("DUPLICATE_FRAGMENT_FILE_ALIAS when an alias is declared twice", () => {
    const { tutor, files } = fresh();
    const [firstFile] = tutor.prompt.fragment_files;
    if (firstFile) tutor.prompt.fragment_files.push({ ...firstFile });
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("DUPLICATE_FRAGMENT_FILE_ALIAS");
  });

  it("DUPLICATE_FRAGMENT_ID_IN_FILE when a file declares a fragment twice", () => {
    const { tutor, files } = fresh();
    const libA = files.get("lib_a");
    const firstFragment = libA?.fragments[0];
    if (libA && firstFragment) libA.fragments.push({ ...firstFragment });
    expect(codes(checkConsistency(tutor.prompt, files))).toContain("DUPLICATE_FRAGMENT_ID_IN_FILE");
  });
});

describe("checkConsistency — warnings", () => {
  it("UNDECLARED_VARIABLE for an extra supplied variable", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "str_frag");
    if (ref?.variables) ref.variables.surprise = "x";
    const result = checkConsistency(tutor.prompt, files);
    expect(result.warnings.map((w) => w.code)).toContain("UNDECLARED_VARIABLE");
    expect(result.errors).toEqual([]);
  });

  it("DUPLICATE_FRAGMENT_REFERENCE when the same fragment is referenced twice", () => {
    const { tutor, files } = fresh();
    const ref = tutor.prompt.fragments.find((f) => f.id === "diagram_frag");
    if (ref) tutor.prompt.fragments.push({ ...ref });
    const result = checkConsistency(tutor.prompt, files);
    expect(result.warnings.map((w) => w.code)).toContain("DUPLICATE_FRAGMENT_REFERENCE");
  });
});

describe("checkConsistency — default values", () => {
  // Add an optional `greeting` (with a default) to the str_frag fragment's schema.
  function withOptionalDefault(): { tutor: Tutor; files: Map<string, FragmentFile> } {
    const { tutor, files } = fresh();
    const schema = files.get("lib_a")?.fragments.find((f) => f.id === "str_frag")?.input_schema;
    if (schema) schema.properties.greeting = { type: "string", default: "Hello!" };
    return { tutor, files };
  }

  it("injects a declared default for an optional variable the tutor omits", () => {
    const { tutor, files } = withOptionalDefault();
    const result = checkConsistency(tutor.prompt, files);
    expect(result.errors).toEqual([]);
    const resolved = result.plan.find((p) => p.fragmentId === "str_frag");
    expect(resolved?.variables.greeting).toBe("Hello!");
  });

  it("lets a supplied value win over the default", () => {
    const { tutor, files } = withOptionalDefault();
    const ref = tutor.prompt.fragments.find((f) => f.id === "str_frag");
    if (ref) ref.variables = { ...ref.variables, greeting: "Hi there" };
    const result = checkConsistency(tutor.prompt, files);
    expect(result.errors).toEqual([]);
    const resolved = result.plan.find((p) => p.fragmentId === "str_frag");
    expect(resolved?.variables.greeting).toBe("Hi there");
  });

  it("does not inject anything for an optional variable without a default", () => {
    const { tutor, files } = fresh();
    const result = checkConsistency(tutor.prompt, files);
    const resolved = result.plan.find((p) => p.fragmentId === "str_frag");
    expect(resolved?.variables).not.toHaveProperty("greeting");
  });

  it("REQUIRED_PROPERTY_HAS_DEFAULT when a required input also declares a default", () => {
    const { tutor, files } = fresh();
    // `topic` is required (and supplied by the fixture); giving it a default is futile.
    const schema = files.get("lib_a")?.fragments.find((f) => f.id === "str_frag")?.input_schema;
    if (schema) schema.properties.topic = { type: "string", default: "anything" };
    const result = checkConsistency(tutor.prompt, files);
    expect(result.warnings.map((w) => w.code)).toContain("REQUIRED_PROPERTY_HAS_DEFAULT");
    expect(result.errors).toEqual([]); // topic is still supplied → no MISSING_REQUIRED_VARIABLE
  });
});
