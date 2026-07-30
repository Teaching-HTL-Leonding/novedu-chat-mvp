import { describe, expect, it } from "vitest";
import { getFragmentInputSchema } from "./fragment-inputs";
import { FragmentFileSchema } from "./schemas";

// `getFragmentInputSchema` is the helper the student GUI uses to discover a
// fragment's variables. Build a real (schema-validated) fragment file so the test
// also documents the shape the GUI works with.

const file = FragmentFileSchema.parse({
  id: "lib",
  fragments: [
    {
      id: "persona",
      version: 1,
      input_schema: {
        type: "object",
        required: ["subject"],
        properties: {
          subject: { type: "string" },
          greeting: { type: "string", default: "Hi!" },
        },
      },
      content: "{{greeting}} You tutor {{subject}}.",
    },
    {
      id: "no-vars",
      content: "static text",
    },
  ],
});

describe("getFragmentInputSchema", () => {
  it("returns the input_schema of the named fragment", () => {
    const schema = getFragmentInputSchema(file, "persona");
    expect(schema?.required).toEqual(["subject"]);
    expect(Object.keys(schema?.properties ?? {})).toEqual(["subject", "greeting"]);
    expect(schema?.properties.greeting).toMatchObject({ type: "string", default: "Hi!" });
  });

  it("returns undefined for a fragment that declares no input_schema", () => {
    expect(getFragmentInputSchema(file, "no-vars")).toBeUndefined();
  });

  it("returns undefined for an unknown fragment id", () => {
    expect(getFragmentInputSchema(file, "missing")).toBeUndefined();
  });
});
