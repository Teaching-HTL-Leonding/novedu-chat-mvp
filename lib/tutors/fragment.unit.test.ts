import { describe, expect, it } from "vitest";
import { checkFragmentFileValue } from "./fragment";
import { loadAndCheckFragmentFile } from "./load";
import { parseYaml } from "./parse";
import { fixtureResponse, readFixture } from "./test-fixtures";

// Parse a YAML string into the `unknown` value `checkFragmentFileValue` expects.
function parse(yaml: string): unknown {
  const parsed = parseYaml(yaml);
  if (!parsed.ok) throw new Error(`test YAML invalid: ${parsed.error.message}`);
  return parsed.value;
}

describe("checkFragmentFileValue", () => {
  it("accepts a valid fragment file (real simple-fragments fixture)", () => {
    const result = checkFragmentFileValue(parse(readFixture("simple-fragments.yaml")));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fragmentFileId).toBe("simple-fragments");
      expect(result.fragmentIds).toEqual(["persona", "ground_rules"]);
    }
  });

  it("FRAGMENT_FILE_SCHEMA_ERROR for a structurally invalid file (no fragments)", () => {
    const result = checkFragmentFileValue(parse("id: x\nfragments: []\n"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("FRAGMENT_FILE_SCHEMA_ERROR");
  });

  it("DUPLICATE_FRAGMENT_ID_IN_FILE for a repeated fragment id", () => {
    const yaml = [
      "id: dup",
      "fragments:",
      "  - id: a",
      "    version: 1",
      "    priority: 100",
      "    content: hi",
      "  - id: a",
      "    version: 1",
      "    priority: 200",
      "    content: bye",
    ].join("\n");
    const result = checkFragmentFileValue(parse(yaml));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "DUPLICATE_FRAGMENT_ID_IN_FILE");
      expect(err?.fragmentId).toBe("a");
    }
  });

  it("FRAGMENT_TEMPLATE_ERROR for a template referencing an undeclared variable", () => {
    // The fixture's `motto` fragment uses `{{undeclared_motto}}`, which its
    // input_schema never declares — strict rendering throws.
    const result = checkFragmentFileValue(parse(readFixture("broken-template-fragments.yaml")));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "FRAGMENT_TEMPLATE_ERROR");
      expect(err?.fragmentId).toBe("motto");
    }
  });

  it("FRAGMENT_TEMPLATE_ERROR for a Handlebars syntax error (unclosed block)", () => {
    const yaml = [
      "id: syn",
      "fragments:",
      "  - id: bad",
      "    version: 1",
      "    priority: 100",
      "    content: |",
      "      {{#each items}}",
      "      - {{this}}",
    ].join("\n");
    const result = checkFragmentFileValue(parse(yaml));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "FRAGMENT_TEMPLATE_ERROR")).toBe(true);
    }
  });

  it("renders a valid {{#each}} over a declared array without error", () => {
    const yaml = [
      "id: ok",
      "fragments:",
      "  - id: list",
      "    version: 1",
      "    priority: 100",
      "    input_schema:",
      "      type: object",
      "      required:",
      "        - items",
      "      properties:",
      "        items:",
      "          type: array",
      "          items:",
      "            type: string",
      "    content: |",
      "      {{#each items}}",
      "      - {{this}}",
      "      {{/each}}",
    ].join("\n");
    expect(checkFragmentFileValue(parse(yaml)).ok).toBe(true);
  });
});

describe("loadAndCheckFragmentFile", () => {
  it("fetches, parses and validates a fragment file by URL", async () => {
    const fetcher = async () => fixtureResponse(readFixture("simple-fragments.yaml"));
    const result = await loadAndCheckFragmentFile(
      "https://example.com/simple-fragments.yaml",
      fetcher,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fragmentFileId).toBe("simple-fragments");
  });

  it("INVALID_URL for a disallowed scheme (no fetch attempted)", async () => {
    const result = await loadAndCheckFragmentFile("ftp://example.com/x.yaml", () => {
      throw new Error("should not fetch");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("INVALID_URL");
  });
});
