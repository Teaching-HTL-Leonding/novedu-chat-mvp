import { describe, expect, it } from "vitest";
import { parse as parseYamlText } from "yaml";
import { checkCodingValue, loadAndCheckCoding } from "@/lib/coding-validate";
import type { Fetcher } from "@/lib/prompt-fragments";

// The coding AUTHORING validator: the strict schema gate. Pure, no network — a
// fixture Fetcher returns YAML text in-process. Coding is ALWAYS anonymous (the API
// path carries no per-student identity), so the validator carries no anonymity flag.

const URL_ = "https://example.com/coding.yaml";
const fetcherFor =
  (text: string, ok = true): Fetcher =>
  async () => ({ ok, status: ok ? 200 : 404, text: async () => text });

const VALID = `
id: buddy
name: "Coding Buddy"
title: "Coding Buddy"
llm:
  model: some-model
instructions: "You are a friendly coding buddy. Keep code beginner-friendly."
`;

describe("loadAndCheckCoding — positive", () => {
  it("accepts a valid activity and reports its metadata", async () => {
    const result = await loadAndCheckCoding(URL_, fetcherFor(VALID));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.codingId).toBe("buddy");
      expect(result.model).toBe("some-model");
      expect(result.provider).toBe("SCCH"); // llm.provider defaults to SCCH
      expect(result.title).toBe("Coding Buddy");
    }
  });

  it("accepts and reports an explicit llm.provider", async () => {
    const foundry = `
id: c
llm:
  model: gpt-5.4-mini
  provider: Azure Foundry
instructions: "Help the student code."
`;
    const result = await loadAndCheckCoding(URL_, fetcherFor(foundry));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provider).toBe("Azure Foundry");
  });

  it("accepts the minimal shape (no name/title) and defaults title to null", async () => {
    const minimal = `
id: c
llm:
  model: m
instructions: "Help the student code."
`;
    const result = await loadAndCheckCoding(URL_, fetcherFor(minimal));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.codingId).toBe("c");
      expect(result.title).toBeNull();
    }
  });
});

describe("loadAndCheckCoding — negative", () => {
  it("rejects a fetch failure as FETCH_FAILED (no throw)", async () => {
    const result = await loadAndCheckCoding(URL_, fetcherFor("", false));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("FETCH_FAILED");
  });

  it("rejects invalid YAML as YAML_PARSE_ERROR", async () => {
    const result = await loadAndCheckCoding(URL_, fetcherFor("id: c\n  bad: : :"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("YAML_PARSE_ERROR");
  });

  it("rejects a disallowed URL scheme as INVALID_URL", async () => {
    const result = await loadAndCheckCoding("file:///etc/passwd", fetcherFor(VALID));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("INVALID_URL");
  });
});

describe("checkCodingValue — schema errors", () => {
  const check = (yaml: string) => checkCodingValue(parseYamlText(yaml), URL_);

  it("rejects an unsupported llm.provider", () => {
    const result = check(`
id: c
llm:
  model: m
  provider: OpenAI
instructions: "Help."
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("CODING_SCHEMA_ERROR");
  });

  it("rejects a missing llm.model", () => {
    const result = check(`
id: c
instructions: "Help."
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("CODING_SCHEMA_ERROR");
  });

  it("rejects a missing instructions block", () => {
    const result = check(`
id: c
llm:
  model: m
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("CODING_SCHEMA_ERROR");
  });

  it("rejects an unrecognized (misspelled) key", () => {
    const result = check(`
id: c
llm:
  model: m
instructons: "typo — should be instructions"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("CODING_SCHEMA_ERROR");
      expect(result.errors[0]?.zodIssues).toBeTruthy();
    }
  });

  it("rejects an `anonymous` field — coding is always anonymous, so it is NOT configurable", () => {
    const result = check(`
id: c
anonymous: false
llm:
  model: m
instructions: "Help."
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("CODING_SCHEMA_ERROR");
  });
});

// --- document-level prompt fragments (identical machinery to quiz/writing) ---------

const LIB_URL = "https://example.com/lib.yaml";
const LIB_YAML = `id: lib
fragments:
  - id: safety
    version: 1
    content: |
      Always be safe and kind.
  - id: lang
    version: 1
    input_schema:
      type: object
      required: [language]
      properties:
        language:
          type: string
    content: |
      Respond in {{language}}.
`;

const fetcherMap =
  (bodies: Record<string, string>): Fetcher =>
  async (url) => {
    const text = bodies[url];
    return text === undefined
      ? { ok: false, status: 404, text: async () => "" }
      : { ok: true, status: 200, text: async () => text };
  };

describe("loadAndCheckCoding — fragments", () => {
  it("accepts an activity that pulls in valid fragments", async () => {
    const coding = `
id: buddy
llm:
  model: m
fragment_files:
  - id: lib
    url: ${LIB_URL}
instructions: |
  {{fragment "lib.safety"}}

  Help beginners.
`;
    const result = await loadAndCheckCoding(
      URL_,
      fetcherMap({ [URL_]: coding, [LIB_URL]: LIB_YAML }),
    );
    expect(result.ok).toBe(true);
  });

  it("a plain activity (no fragments) is still valid", async () => {
    const result = await loadAndCheckCoding(URL_, fetcherMap({ [URL_]: VALID }));
    expect(result.ok).toBe(true);
  });

  it("surfaces a fragment consistency error (missing required variable)", async () => {
    const coding = `
id: buddy
llm:
  model: m
fragment_files:
  - id: lib
    url: ${LIB_URL}
instructions: |
  {{fragment "lib.lang"}}

  Help beginners.
`;
    const result = await loadAndCheckCoding(
      URL_,
      fetcherMap({ [URL_]: coding, [LIB_URL]: LIB_YAML }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain("MISSING_REQUIRED_VARIABLE");
  });
});

// --- document-level text files ({{file "alias"}}) — authoring gate (validateLibraries: true)
const TEXT_URL = "https://example.com/solution.ts";
const SOLUTION_BODY =
  "export const first = 1;\nexport const second = 2;\nexport const third = 3;\n";

describe("loadAndCheckCoding — text files", () => {
  it("accepts an activity that embeds a sample-solution file with an in-bounds {{file}} marker", async () => {
    const coding = `
id: buddy
llm:
  model: m
text_files:
  - id: solution
    url: ${TEXT_URL}
instructions: |
  Sample solution:
  {{file "solution" from=1 to=2}}
`;
    const result = await loadAndCheckCoding(
      URL_,
      fetcherMap({ [URL_]: coding, [TEXT_URL]: SOLUTION_BODY }),
    );
    expect(result.ok).toBe(true);
  });

  it("TEXT_FILE_RANGE_OUT_OF_BOUNDS for a `from` past end-of-file", async () => {
    const coding = `
id: buddy
llm:
  model: m
text_files:
  - id: solution
    url: ${TEXT_URL}
instructions: |
  {{file "solution" from=99}}
`;
    const result = await loadAndCheckCoding(
      URL_,
      fetcherMap({ [URL_]: coding, [TEXT_URL]: SOLUTION_BODY }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("TEXT_FILE_RANGE_OUT_OF_BOUNDS");
    }
  });
});
