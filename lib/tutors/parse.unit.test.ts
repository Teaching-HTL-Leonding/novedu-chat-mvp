import { describe, expect, it } from "vitest";
import { parseYaml, validate } from "./parse";
import { FragmentFileSchema, TutorSchema } from "./schemas";
import { readFixture } from "./test-fixtures";

describe("parseYaml", () => {
  it("parses the real tutor fixture", () => {
    const result = parseYaml(readFixture("linked-list-tutor.yaml"));
    expect(result.ok).toBe(true);
  });

  it("reports YAML_PARSE_ERROR for malformed YAML", () => {
    const result = parseYaml("foo: [1, 2"); // unterminated flow sequence
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("YAML_PARSE_ERROR");
  });
});

describe("validate — tutor", () => {
  it("accepts the real tutor fixture", () => {
    const parsed = parseYaml(readFixture("linked-list-tutor.yaml"));
    if (!parsed.ok) throw new Error("precondition: tutor YAML must parse");
    const result = validate(parsed.value, TutorSchema, "TUTOR_SCHEMA_ERROR");
    expect(result.ok).toBe(true);
  });

  it("rejects a tutor missing prompt.tutor_instructions", () => {
    const parsed = parseYaml(readFixture("linked-list-tutor.yaml"));
    if (!parsed.ok) throw new Error("precondition");
    const broken = structuredClone(parsed.value) as { prompt: Record<string, unknown> };
    delete broken.prompt.tutor_instructions;
    const result = validate(broken, TutorSchema, "TUTOR_SCHEMA_ERROR");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TUTOR_SCHEMA_ERROR");
      expect(result.error.zodIssues).toBeDefined();
    }
  });

  it("rejects unknown top-level keys (strictObject)", () => {
    const result = validate({ surprise: true }, TutorSchema, "TUTOR_SCHEMA_ERROR");
    expect(result.ok).toBe(false);
  });

  it("defaults llm.provider to SCCH, accepts Azure Foundry, rejects junk", () => {
    const parsed = parseYaml(readFixture("linked-list-tutor.yaml"));
    if (!parsed.ok) throw new Error("precondition");
    const tutor = structuredClone(parsed.value) as { llm: Record<string, unknown> };

    const defaulted = validate(tutor, TutorSchema, "TUTOR_SCHEMA_ERROR");
    expect(defaulted.ok && defaulted.data.llm.provider).toBe("SCCH");

    tutor.llm.provider = "Azure Foundry";
    const foundry = validate(tutor, TutorSchema, "TUTOR_SCHEMA_ERROR");
    expect(foundry.ok && foundry.data.llm.provider).toBe("Azure Foundry");

    tutor.llm.provider = "OpenAI";
    expect(validate(tutor, TutorSchema, "TUTOR_SCHEMA_ERROR").ok).toBe(false);
  });
});

describe("validate — fragment file", () => {
  it("accepts both real fragment files", () => {
    for (const name of ["general-fragments.yaml", "linked-list-fragments.yaml"]) {
      const parsed = parseYaml(readFixture(name));
      if (!parsed.ok) throw new Error(`precondition: ${name} must parse`);
      const result = validate(parsed.value, FragmentFileSchema, "FRAGMENT_FILE_SCHEMA_ERROR");
      expect(result.ok, name).toBe(true);
    }
  });

  it("rejects a fragment file with an empty fragments array", () => {
    const result = validate(
      { id: "x", fragments: [] },
      FragmentFileSchema,
      "FRAGMENT_FILE_SCHEMA_ERROR",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an array input_schema property without items", () => {
    const file = {
      id: "x",
      fragments: [
        {
          id: "f",
          version: 1,
          priority: 1,
          content: "hi",
          input_schema: { type: "object", required: [], properties: { xs: { type: "array" } } },
        },
      ],
    };
    const result = validate(file, FragmentFileSchema, "FRAGMENT_FILE_SCHEMA_ERROR");
    expect(result.ok).toBe(false);
  });
});
