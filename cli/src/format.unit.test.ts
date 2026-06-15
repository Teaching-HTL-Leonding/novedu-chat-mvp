// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BuildResult, FragmentCheckResult } from "@/lib/tutors";
import { formatFragmentResult, formatResult } from "./format";

// The formatter is pure presentation; these tests pin that a schema error's Zod
// field detail makes it into the human-readable report (not just the generic
// message), so the CLI is as diagnosable as the web UI.

describe("formatResult — schema error detail", () => {
  it("flattens zod issues beneath the tutor error line", () => {
    const result: BuildResult = {
      ok: false,
      warnings: [],
      errors: [
        {
          code: "TUTOR_SCHEMA_ERROR",
          message: "Document does not match the expected structure",
          zodIssues: {
            errors: ['Unrecognized key: "nae"'],
            properties: {
              name: { errors: ["Invalid input: expected string, received undefined"] },
            },
          },
        },
      ],
    };

    const out = formatResult(result, "tutor.yaml");

    expect(out).toContain("TUTOR_SCHEMA_ERROR");
    expect(out).toContain('Unrecognized key: "nae"');
    expect(out).toContain("name: Invalid input: expected string, received undefined");
  });
});

describe("formatFragmentResult — schema error detail", () => {
  it("flattens zod issues beneath the fragment error line", () => {
    const result: FragmentCheckResult = {
      ok: false,
      warnings: [],
      errors: [
        {
          code: "FRAGMENT_FILE_SCHEMA_ERROR",
          message: "Document does not match the expected structure",
          zodIssues: { properties: { id: { errors: ["Invalid input: expected string"] } } },
        },
      ],
    };

    const out = formatFragmentResult(result, "fragments.yaml");

    expect(out).toContain("FRAGMENT_FILE_SCHEMA_ERROR");
    expect(out).toContain("id: Invalid input: expected string");
  });
});
