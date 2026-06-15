import { describe, expect, it } from "vitest";
import { formatZodIssues } from "./errors";

describe("formatZodIssues", () => {
  it("flattens nested properties and array items into path-prefixed lines", () => {
    const lines = formatZodIssues({
      errors: ["root problem"],
      properties: {
        prompt: {
          errors: [],
          properties: { fragments: { errors: ["Too small: expected >=1 items"] } },
        },
      },
      items: [null, { errors: ["bad item"] }],
    });

    expect(lines).toContain("root problem");
    expect(lines).toContain("prompt.fragments: Too small: expected >=1 items");
    expect(lines).toContain("1: bad item");
  });

  it("surfaces an unrecognized-key typo as an actionable line", () => {
    expect(
      formatZodIssues({
        errors: ['Unrecognized key: "nae"'],
        properties: { name: { errors: ["Invalid input: expected string, received undefined"] } },
      }),
    ).toEqual([
      'Unrecognized key: "nae"',
      "name: Invalid input: expected string, received undefined",
    ]);
  });

  it("returns an empty array for nullish input", () => {
    expect(formatZodIssues(undefined)).toEqual([]);
    expect(formatZodIssues(null)).toEqual([]);
  });
});
