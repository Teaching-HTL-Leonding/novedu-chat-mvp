import { describe, expect, it } from "vitest";
import type { Fetcher } from "./fetcher";
import { loadAndBuildTutorPrompt, resolveFragmentUrl } from "./load";
import {
  fixtureFetcher,
  fixtureResponse,
  GENERAL_URL,
  LINKED_URL,
  readFixture,
  TUTOR_URL,
} from "./test-fixtures";

describe("loadAndBuildTutorPrompt — happy path", () => {
  it("builds the prompt from the real fixtures with no network", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("Knoten"); // German prose from a fragment
      expect(result.prompt).toContain("->"); // ASCII diagram, unescaped
      expect(result.model).toBe("RedHatAI/gemma-4-31B-it-FP8-Dynamic"); // from the tutor's llm.model
    }
  });

  it("only fetches the tutor URL and its declared fragment files", async () => {
    const seen: string[] = [];
    const base = fixtureFetcher();
    const spy: Fetcher = (url) => {
      seen.push(url);
      return base(url);
    };
    await loadAndBuildTutorPrompt(TUTOR_URL, spy);
    // The real fixture uses relative refs (`general-fragments.yaml`); seeing the
    // absolute GENERAL_URL/LINKED_URL fetched proves they were resolved against TUTOR_URL.
    expect(new Set(seen)).toEqual(new Set([TUTOR_URL, GENERAL_URL, LINKED_URL]));
  });
});

describe("loadAndBuildTutorPrompt — image input flag", () => {
  // The real fixture declares no `llm.imageInput`; these variants patch the
  // llm block to exercise the flag without a second fixture file.
  const withImageInput = (value: string) =>
    readFixture("linked-list-tutor.yaml").replace(
      "  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic",
      `  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic\n  imageInput: ${value}`,
    );

  it("defaults imageInput to true when the tutor omits llm.imageInput", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.imageInput).toBe(true);
  });

  it("surfaces an explicit imageInput: false opt-out from the tutor's llm block", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse(withImageInput("false"))]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.imageInput).toBe(false);
  });

  it("TUTOR_SCHEMA_ERROR for a non-boolean imageInput", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse(withImageInput('"yes"'))]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("TUTOR_SCHEMA_ERROR");
  });

  // Both YAMLs are documented examples AND e2e fixtures — keep them valid.
  for (const [fixture, expected] of [
    ["vision-tutor.yaml", true],
    ["text-only-tutor.yaml", false],
  ] as const) {
    it(`the ${fixture} fixture resolves to imageInput: ${expected}`, async () => {
      const url = TUTOR_URL.replace("linked-list-tutor.yaml", fixture);
      const simpleUrl = TUTOR_URL.replace("linked-list-tutor.yaml", "simple-fragments.yaml");
      const overrides = new Map([
        [url, fixtureResponse(readFixture(fixture))],
        [simpleUrl, fixtureResponse(readFixture("simple-fragments.yaml"))],
      ]);
      const result = await loadAndBuildTutorPrompt(url, fixtureFetcher(overrides));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.imageInput).toBe(expected);
    });
  }
});

describe("loadAndBuildTutorPrompt — anonymous flag", () => {
  // The real fixture declares no `anonymous`; these variants prepend the
  // top-level field to exercise the flag without a second fixture file.
  const withAnonymous = (value: string) =>
    `anonymous: ${value}\n${readFixture("linked-list-tutor.yaml")}`;

  it("defaults anonymous to true when the tutor omits it", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.anonymous).toBe(true);
  });

  it("surfaces an explicit anonymous: false opt-in to chat attribution", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse(withAnonymous("false"))]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.anonymous).toBe(false);
  });

  it("keeps an explicit anonymous: true anonymous", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse(withAnonymous("true"))]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.anonymous).toBe(true);
  });

  it("TUTOR_SCHEMA_ERROR for a non-boolean anonymous", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse(withAnonymous('"no"'))]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("TUTOR_SCHEMA_ERROR");
  });
});

describe("loadAndBuildTutorPrompt — title & description", () => {
  it("surfaces the tutor's title and description for the welcome screen", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe("Dein Tutor für verkettete Listen");
      expect(result.description).toContain("verkettete Listen");
    }
  });

  it("leaves title undefined when the tutor omits it (description stays required)", async () => {
    const withoutTitle = readFixture("linked-list-tutor.yaml").replace(/^title: .*\n/m, "");
    const overrides = new Map([[TUTOR_URL, fixtureResponse(withoutTitle)]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBeUndefined();
      expect(result.description.length).toBeGreaterThan(0);
    }
  });
});

describe("loadAndBuildTutorPrompt — example questions", () => {
  // The fixture's exampleQuestions block sits between `description:` and `llm:`.
  const withoutExampleQuestions = () =>
    readFixture("linked-list-tutor.yaml").replace(/^exampleQuestions:[\s\S]*?(?=^llm:)/m, "");

  it("surfaces the tutor's example questions for the welcome screen", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exampleQuestions).toHaveLength(6);
      expect(result.exampleQuestions[0]).toEqual({
        title: "Was ist eine verkettete Liste?",
        question:
          "Kannst du mir erklären, was eine verkettete Liste ist und wie sie sich von einem Array unterscheidet?",
      });
    }
  });

  it("normalizes an omitted exampleQuestions field to an empty array", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse(withoutExampleQuestions())]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.exampleQuestions).toEqual([]);
  });

  it("TUTOR_SCHEMA_ERROR for an example question with an empty title", async () => {
    const broken = `${withoutExampleQuestions().replace(
      /^llm:/m,
      'exampleQuestions:\n  - title: ""\n    question: "Wie geht das?"\nllm:',
    )}`;
    const overrides = new Map([[TUTOR_URL, fixtureResponse(broken)]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("TUTOR_SCHEMA_ERROR");
  });
});

describe("resolveFragmentUrl", () => {
  it("returns an absolute http(s) ref unchanged", () => {
    expect(resolveFragmentUrl(GENERAL_URL, TUTOR_URL)).toBe(GENERAL_URL);
    expect(resolveFragmentUrl("http://example.com/x.yaml", TUTOR_URL)).toBe(
      "http://example.com/x.yaml",
    );
  });

  it("resolves a bare filename against the tutor's directory (filename dropped)", () => {
    expect(resolveFragmentUrl("general-fragments.yaml", TUTOR_URL)).toBe(GENERAL_URL);
  });

  it("resolves ./ and ../ segments", () => {
    expect(resolveFragmentUrl("./general-fragments.yaml", TUTOR_URL)).toBe(GENERAL_URL);
    // TUTOR_URL lives in `.../main/activities/tutors/`; `../` steps up to `.../main/activities/`.
    expect(resolveFragmentUrl("../other/x.yaml", TUTOR_URL)).toBe(
      "https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/other/x.yaml",
    );
  });

  it("lets an absolute ref to a different host override the base", () => {
    expect(resolveFragmentUrl("https://other.example/z.yaml", TUTOR_URL)).toBe(
      "https://other.example/z.yaml",
    );
  });
});

describe("loadAndBuildTutorPrompt — fragment URL resolution", () => {
  // Rewrite the (now relative) fixture refs back to absolute to prove absolute still works.
  const absoluteTutorBody = readFixture("linked-list-tutor.yaml")
    .replace("general-fragments.yaml", GENERAL_URL)
    .replace("linked-list-fragments.yaml", LINKED_URL);

  it("still supports absolute fragment refs", async () => {
    const seen: string[] = [];
    const overrides = new Map([[TUTOR_URL, fixtureResponse(absoluteTutorBody)]]);
    const base = fixtureFetcher(overrides);
    const spy: Fetcher = (url) => {
      seen.push(url);
      return base(url);
    };
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, spy);
    expect(result.ok).toBe(true);
    expect(new Set(seen)).toEqual(new Set([TUTOR_URL, GENERAL_URL, LINKED_URL]));
  });

  it("supports a mix of absolute and relative refs in one tutor", async () => {
    // general → absolute URL, linked-list → left relative.
    const mixedBody = readFixture("linked-list-tutor.yaml").replace(
      "general-fragments.yaml",
      GENERAL_URL,
    );
    const overrides = new Map([[TUTOR_URL, fixtureResponse(mixedBody)]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(true);
  });

  it("TUTOR_SCHEMA_ERROR for an absolute non-http(s) fragment ref", async () => {
    const ftpBody = readFixture("linked-list-tutor.yaml").replace(
      "general-fragments.yaml",
      "ftp://example.com/frag.yaml",
    );
    const overrides = new Map([[TUTOR_URL, fixtureResponse(ftpBody)]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("TUTOR_SCHEMA_ERROR");
  });
});

describe("loadAndBuildTutorPrompt — failures", () => {
  it("INVALID_URL for a non-http(s) URL (no fetch attempted)", async () => {
    const result = await loadAndBuildTutorPrompt("ftp://example.com/t.yaml", () => {
      throw new Error("should not fetch");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("INVALID_URL");
  });

  it("FETCH_FAILED when the tutor URL returns non-2xx", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse("", { ok: false, status: 404 })]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("FETCH_FAILED");
      expect(result.errors[0]?.status).toBe(404);
    }
  });

  it("FETCH_FAILED when the fetcher throws (network down)", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, () =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("FETCH_FAILED");
  });

  it("YAML_PARSE_ERROR for a malformed tutor body", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse("foo: [1, 2")]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("YAML_PARSE_ERROR");
  });

  it("FRAGMENT_FILE_SCHEMA_ERROR for a default whose type mismatches its property", async () => {
    // A boolean property with a string default must be rejected at schema validation.
    const badFragmentFile = [
      "id: general-fragments",
      "fragments:",
      "  - id: socratic_tutor",
      "    version: 1",
      "    priority: 100",
      "    input_schema:",
      "      type: object",
      "      properties:",
      "        flag:",
      "          type: boolean",
      '          default: "not a boolean"',
      "    content: hi",
    ].join("\n");
    const overrides = new Map([[GENERAL_URL, fixtureResponse(badFragmentFile)]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("FRAGMENT_FILE_SCHEMA_ERROR");
    }
  });

  it("collects every failing fragment file (parallel, not short-circuited)", async () => {
    const overrides = new Map([
      [GENERAL_URL, fixtureResponse("", { ok: false, status: 500 })],
      [LINKED_URL, fixtureResponse("", { ok: false, status: 503 })],
    ]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const failedUrls = result.errors.filter((e) => e.code === "FETCH_FAILED").map((e) => e.url);
      expect(failedUrls).toContain(GENERAL_URL);
      expect(failedUrls).toContain(LINKED_URL);
    }
  });
});

describe("loadAndBuildTutorPrompt — validateLibraries (thorough whole-library check)", () => {
  // Append an UNUSED fragment with a broken template (it references a variable its
  // input_schema never declares) to a real referenced library. The tutor never
  // references this fragment, so it only matters under the whole-library check.
  const generalWithBrokenUnused = () =>
    `${readFixture("general-fragments.yaml")}
  - id: broken_unused
    version: 1
    priority: 9999
    content: |
      You forgot to declare {{undeclared_var}}.
`;

  it("passes when every referenced library is fully valid (real fixtures)", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(), {
      validateLibraries: true,
    });
    expect(result.ok).toBe(true);
  });

  it("does NOT check unused fragments when the option is off (chat hot path unaffected)", async () => {
    const overrides = new Map([[GENERAL_URL, fixtureResponse(generalWithBrokenUnused())]]);
    // The broken fragment is unused; the default (hot-path) build still succeeds.
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(true);
  });

  it("FRAGMENT_TEMPLATE_ERROR (with fileAlias) for a broken unused fragment when on", async () => {
    const overrides = new Map([[GENERAL_URL, fixtureResponse(generalWithBrokenUnused())]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides), {
      validateLibraries: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "FRAGMENT_TEMPLATE_ERROR");
      expect(err?.fragmentId).toBe("broken_unused");
      expect(err?.fileAlias).toBe("general_fragments");
    }
  });
});
