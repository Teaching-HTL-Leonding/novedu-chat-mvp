import { describe, expect, it } from "vitest";
import { parse as parseYamlText } from "yaml";
import type { Fetcher } from "@/lib/tutors";
import { checkWritingValue, loadAndCheckWriting } from "@/lib/writing-validate";

// The writing AUTHORING validator: the strict schema gate. Pure, no network — a
// fixture Fetcher returns YAML text in-process. Writing DIVERGES: anonymous
// defaults to FALSE (attributed).

const URL_ = "https://example.com/writing.yaml";
const fetcherFor =
  (text: string, ok = true): Fetcher =>
  async () => ({ ok, status: ok ? 200 : 404, text: async () => text });

const VALID = `
id: essay
name: "Essay"
title: "Write an essay"
description: "Write 400 words."
anonymous: true
llm:
  model: some-model
instructions: "You are a writing coach. Read the draft, then advise."
placeholder: ""
`;

describe("loadAndCheckWriting — positive", () => {
  it("accepts a valid activity and reports its metadata", async () => {
    const result = await loadAndCheckWriting(URL_, fetcherFor(VALID));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.writingId).toBe("essay");
      expect(result.model).toBe("some-model");
      expect(result.anonymous).toBe(true);
      expect(result.title).toBe("Write an essay");
    }
  });

  it("DEFAULTS anonymous to FALSE (the writing divergence) when omitted", async () => {
    const minimal = `
id: w
llm:
  model: m
instructions: "Coach the student."
`;
    const result = await loadAndCheckWriting(URL_, fetcherFor(minimal));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.anonymous).toBe(false);
      expect(result.title).toBeNull();
    }
  });
});

describe("loadAndCheckWriting — negative", () => {
  it("rejects a fetch failure as FETCH_FAILED (no throw)", async () => {
    const result = await loadAndCheckWriting(URL_, fetcherFor("", false));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("FETCH_FAILED");
  });

  it("rejects invalid YAML as YAML_PARSE_ERROR", async () => {
    const result = await loadAndCheckWriting(URL_, fetcherFor("id: w\n  bad: : :"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("YAML_PARSE_ERROR");
  });

  it("rejects a disallowed URL scheme as INVALID_URL", async () => {
    const result = await loadAndCheckWriting("file:///etc/passwd", fetcherFor(VALID));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("INVALID_URL");
  });
});

describe("checkWritingValue — schema errors", () => {
  const check = (yaml: string) => checkWritingValue(parseYamlText(yaml), URL_);

  it("rejects a missing llm.model", () => {
    const result = check(`
id: w
instructions: "Coach."
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("WRITING_SCHEMA_ERROR");
  });

  it("rejects a missing instructions block", () => {
    const result = check(`
id: w
llm:
  model: m
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("WRITING_SCHEMA_ERROR");
  });

  it("rejects an unrecognized (misspelled) key", () => {
    const result = check(`
id: w
llm:
  model: m
instructons: "typo — should be instructions"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("WRITING_SCHEMA_ERROR");
      expect(result.errors[0]?.zodIssues).toBeTruthy();
    }
  });
});
