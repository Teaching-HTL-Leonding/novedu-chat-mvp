import { describe, expect, it } from "vitest";
import {
  checkPlacements,
  type FragmentFile,
  type FragmentFileRef,
  type Placement,
  resolveAndMerge,
  type TextFileRef,
} from "@/lib/prompt-fragments";
import { LIB_A_URL, LIB_B_URL, loadFixtureFragmentFiles } from "./test-fixtures";

// Placement checking over the synthetic fragment libraries. Each test constructs the
// inline placements directly (what `parseHostPlacements` would extract from a host
// text) and mutates a clone of the libraries to trigger exactly one category.

const FILE_REFS: FragmentFileRef[] = [
  { id: "lib_a", url: LIB_A_URL },
  { id: "lib_b", url: LIB_B_URL },
];

function placement(ref: string, args: Placement["args"] = {}): Placement {
  return { kind: "fragment", ref, args, line: 1, column: 1 };
}

/** The six placements that mirror the fixture HOST_TEXT — self-consistent. */
const HAPPY: Placement[] = [
  placement("lib_a.str_frag", { topic: "T" }),
  placement("lib_a.list_frag", { items: ["a", "b"] }),
  placement("lib_a.flag_frag", { enabled: false }),
  placement("lib_b.diagram_frag"),
  placement("lib_b.plain_frag"),
  placement("lib_a.safety_frag"),
];

function codes(result: { errors: { code: string }[] }): string[] {
  return result.errors.map((e) => e.code);
}
function warnCodes(result: { warnings: { code: string }[] }): string[] {
  return result.warnings.map((w) => w.code);
}

describe("checkPlacements — happy path", () => {
  it("accepts self-consistent placements with no errors and no warnings", () => {
    const result = checkPlacements(HAPPY, loadFixtureFragmentFiles(), FILE_REFS);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("allows the same fragment to be placed more than once (no duplicate warning)", () => {
    const twice = [placement("lib_b.plain_frag"), placement("lib_b.plain_frag"), ...HAPPY];
    const result = checkPlacements(twice, loadFixtureFragmentFiles(), FILE_REFS);
    expect(result.errors).toEqual([]);
    // There is deliberately no DUPLICATE_FRAGMENT_REFERENCE concept anymore.
    expect(warnCodes(result)).not.toContain("UNUSED_FRAGMENT_FILE");
  });
});

describe("checkPlacements — errors", () => {
  it("UNKNOWN_FRAGMENT_FILE_ALIAS for a bad file alias", () => {
    const result = checkPlacements(
      [placement("does_not_exist.str_frag", { topic: "T" })],
      loadFixtureFragmentFiles(),
      FILE_REFS,
    );
    expect(codes(result)).toContain("UNKNOWN_FRAGMENT_FILE_ALIAS");
  });

  it("FRAGMENT_NOT_FOUND for a bad fragment id", () => {
    const result = checkPlacements(
      [placement("lib_a.no_such_fragment")],
      loadFixtureFragmentFiles(),
      FILE_REFS,
    );
    expect(codes(result)).toContain("FRAGMENT_NOT_FOUND");
  });

  it("MISSING_REQUIRED_VARIABLE when a required input is absent", () => {
    const result = checkPlacements(
      [placement("lib_a.str_frag")],
      loadFixtureFragmentFiles(),
      FILE_REFS,
    );
    expect(codes(result)).toContain("MISSING_REQUIRED_VARIABLE");
    expect(result.errors.find((e) => e.code === "MISSING_REQUIRED_VARIABLE")?.variable).toBe(
      "topic",
    );
  });

  it("VARIABLE_TYPE_MISMATCH: array where string expected", () => {
    const result = checkPlacements(
      [placement("lib_a.str_frag", { topic: ["not", "a", "string"] })],
      loadFixtureFragmentFiles(),
      FILE_REFS,
    );
    expect(codes(result)).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("VARIABLE_TYPE_MISMATCH: string where boolean expected", () => {
    const result = checkPlacements(
      [placement("lib_a.flag_frag", { enabled: "false" })],
      loadFixtureFragmentFiles(),
      FILE_REFS,
    );
    expect(codes(result)).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("VARIABLE_TYPE_MISMATCH: string where array expected", () => {
    const result = checkPlacements(
      [placement("lib_a.list_frag", { items: "oops" as unknown as string[] })],
      loadFixtureFragmentFiles(),
      FILE_REFS,
    );
    expect(codes(result)).toContain("VARIABLE_TYPE_MISMATCH");
  });

  it("DUPLICATE_FRAGMENT_FILE_ALIAS when an alias is declared twice", () => {
    const dupRefs: FragmentFileRef[] = [...FILE_REFS, { id: "lib_a", url: LIB_A_URL }];
    const result = checkPlacements(HAPPY, loadFixtureFragmentFiles(), dupRefs);
    expect(codes(result)).toContain("DUPLICATE_FRAGMENT_FILE_ALIAS");
  });

  it("DUPLICATE_FRAGMENT_ID_IN_FILE when a file declares a fragment twice", () => {
    const files = loadFixtureFragmentFiles();
    const libA = files.get("lib_a");
    const first = libA?.fragments[0];
    if (libA && first) libA.fragments.push({ ...first });
    expect(codes(checkPlacements(HAPPY, files, FILE_REFS))).toContain(
      "DUPLICATE_FRAGMENT_ID_IN_FILE",
    );
  });
});

describe("checkPlacements — warnings", () => {
  it("UNDECLARED_VARIABLE for an extra supplied variable", () => {
    const result = checkPlacements(
      [placement("lib_a.str_frag", { topic: "T", surprise: "x" })],
      loadFixtureFragmentFiles(),
      FILE_REFS,
    );
    expect(warnCodes(result)).toContain("UNDECLARED_VARIABLE");
    expect(result.errors).toEqual([]);
  });

  it("UNUSED_FRAGMENT_FILE when a declared library is never placed", () => {
    // Only lib_a is used; lib_b is declared but no placement draws from it.
    const onlyLibA = [placement("lib_a.safety_frag")];
    const result = checkPlacements(onlyLibA, loadFixtureFragmentFiles(), FILE_REFS);
    expect(warnCodes(result)).toContain("UNUSED_FRAGMENT_FILE");
    expect(result.warnings.find((w) => w.code === "UNUSED_FRAGMENT_FILE")?.fileAlias).toBe("lib_b");
    expect(result.errors).toEqual([]);
  });
});

// --- text-file placements ({{file "alias" from= to=}}) --------------------------------
// checkPlacements dispatches on placement.kind: file placements resolve against the
// text-file map (alias + line-range bounds), fragment placements ignore the text side and
// vice versa. The text-file body is passed as its FETCHED string keyed by alias.

const COURSE_BODY = "L1\nL2\nL3\n"; // 3 logical lines (trailing newline not counted)
const TEXT_REFS: TextFileRef[] = [{ id: "course", url: "https://example.com/course.md" }];
const textMap = () => new Map<string, string>([["course", COURSE_BODY]]);

function filePlacement(ref: string, range: { from?: number; to?: number } = {}): Placement {
  return { kind: "file", ref, args: {}, ...range, line: 1, column: 1 };
}

describe("checkPlacements — text files", () => {
  it("accepts an in-bounds file placement with no errors or warnings", () => {
    const result = checkPlacements(
      [filePlacement("course", { from: 1, to: 2 })],
      new Map(),
      [],
      textMap(),
      TEXT_REFS,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("UNKNOWN_TEXT_FILE_ALIAS for a {{file}} alias with no declared text file", () => {
    const result = checkPlacements([filePlacement("missing")], new Map(), [], textMap(), TEXT_REFS);
    expect(codes(result)).toContain("UNKNOWN_TEXT_FILE_ALIAS");
  });

  it("DUPLICATE_TEXT_FILE_ALIAS when a text alias is declared twice", () => {
    const dupRefs: TextFileRef[] = [...TEXT_REFS, { id: "course", url: "https://x/y.md" }];
    const result = checkPlacements([], new Map(), [], textMap(), dupRefs);
    expect(codes(result)).toContain("DUPLICATE_TEXT_FILE_ALIAS");
  });

  it("DUPLICATE_TEXT_FILE_ALIAS when a text alias collides with a fragment-file id", () => {
    // ONE shared alias namespace: `lib_a` names a fragment library AND a text file.
    const collidingText: TextFileRef[] = [{ id: "lib_a", url: "https://example.com/x.md" }];
    const result = checkPlacements(
      [],
      loadFixtureFragmentFiles(),
      FILE_REFS,
      new Map([["lib_a", COURSE_BODY]]),
      collidingText,
    );
    expect(codes(result)).toContain("DUPLICATE_TEXT_FILE_ALIAS");
  });

  it("TEXT_FILE_RANGE_OUT_OF_BOUNDS when `from` is beyond EOF (ALWAYS, even at runtime)", () => {
    const result = checkPlacements(
      [filePlacement("course", { from: 99 })],
      new Map(),
      [],
      textMap(),
      TEXT_REFS,
      false, // runtime strictness
    );
    expect(codes(result)).toContain("TEXT_FILE_RANGE_OUT_OF_BOUNDS");
  });

  it("does NOT error on a `to` beyond EOF at runtime (the render layer clamps)", () => {
    const result = checkPlacements(
      [filePlacement("course", { to: 99 })],
      new Map(),
      [],
      textMap(),
      TEXT_REFS,
      false,
    );
    expect(codes(result)).not.toContain("TEXT_FILE_RANGE_OUT_OF_BOUNDS");
    expect(result.errors).toEqual([]);
  });

  it("DOES error on a `to` beyond EOF under strict (authoring) mode", () => {
    const result = checkPlacements(
      [filePlacement("course", { to: 99 })],
      new Map(),
      [],
      textMap(),
      TEXT_REFS,
      true, // authoring strictness
    );
    expect(codes(result)).toContain("TEXT_FILE_RANGE_OUT_OF_BOUNDS");
  });

  it("UNUSED_TEXT_FILE warning when a declared text file is never placed", () => {
    const result = checkPlacements([], new Map(), [], textMap(), TEXT_REFS);
    expect(warnCodes(result)).toContain("UNUSED_TEXT_FILE");
    expect(result.warnings.find((w) => w.code === "UNUSED_TEXT_FILE")?.fileAlias).toBe("course");
    expect(result.errors).toEqual([]);
  });

  it("dispatches a mix of fragment and file placements without cross-contamination", () => {
    const result = checkPlacements(
      [placement("lib_a.safety_frag"), filePlacement("course", { from: 1, to: 3 })],
      loadFixtureFragmentFiles(),
      [{ id: "lib_a", url: LIB_A_URL }],
      textMap(),
      TEXT_REFS,
    );
    expect(result.errors).toEqual([]);
    // Both the fragment library and the text file are used — no UNUSED_* warnings.
    expect(warnCodes(result)).not.toContain("UNUSED_FRAGMENT_FILE");
    expect(warnCodes(result)).not.toContain("UNUSED_TEXT_FILE");
  });
});

describe("resolveAndMerge — defaults & content", () => {
  function withOptionalDefault(): Map<string, FragmentFile> {
    const files = loadFixtureFragmentFiles();
    const schema = files.get("lib_a")?.fragments.find((f) => f.id === "str_frag")?.input_schema;
    if (schema) schema.properties.greeting = { type: "string", default: "Hello!" };
    return files;
  }

  it("returns the fragment content for a resolved reference", () => {
    const r = resolveAndMerge("lib_a.str_frag", { topic: "T" }, loadFixtureFragmentFiles());
    expect(r.content).toContain("FIRST-MARKER");
    expect(r.errors).toEqual([]);
  });

  it("returns null content for an unresolved reference", () => {
    const r = resolveAndMerge("lib_a.nope", {}, loadFixtureFragmentFiles());
    expect(r.content).toBeNull();
    expect(r.errors.map((e) => e.code)).toContain("FRAGMENT_NOT_FOUND");
  });

  it("injects a declared default for an optional variable the placement omits", () => {
    const r = resolveAndMerge("lib_a.str_frag", { topic: "T" }, withOptionalDefault());
    expect(r.errors).toEqual([]);
    expect(r.variables.greeting).toBe("Hello!");
  });

  it("lets a supplied value win over the default", () => {
    const r = resolveAndMerge(
      "lib_a.str_frag",
      { topic: "T", greeting: "Hi there" },
      withOptionalDefault(),
    );
    expect(r.variables.greeting).toBe("Hi there");
  });

  it("does not inject anything for an optional variable without a default", () => {
    const r = resolveAndMerge("lib_a.str_frag", { topic: "T" }, loadFixtureFragmentFiles());
    expect(r.variables).not.toHaveProperty("greeting");
  });

  it("REQUIRED_PROPERTY_HAS_DEFAULT when a required input also declares a default", () => {
    const files = loadFixtureFragmentFiles();
    const schema = files.get("lib_a")?.fragments.find((f) => f.id === "str_frag")?.input_schema;
    if (schema) schema.properties.topic = { type: "string", default: "anything" };
    const r = resolveAndMerge("lib_a.str_frag", { topic: "T" }, files);
    expect(r.warnings.map((w) => w.code)).toContain("REQUIRED_PROPERTY_HAS_DEFAULT");
    expect(r.errors).toEqual([]);
  });
});
