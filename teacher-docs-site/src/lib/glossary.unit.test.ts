// @vitest-environment node
// Pure-Node tests (fs + mdast fixtures) — the app's default jsdom environment
// is unnecessary here and rewrites import.meta.url to a non-file: URL.
import type { Paragraph, Root } from "mdast";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLookup, type GlossaryEntry, normalizeTermKey, parseGlossary } from "./glossary.ts";
import { withBase } from "./paths.ts";
import { remarkGlossaryTerms } from "./remark-glossary-terms.ts";
import { slugifyTerm } from "./slug.ts";

describe("slugifyTerm", () => {
  it("slugs plain and awkward terms", () => {
    expect(slugifyTerm("Activity")).toBe("activity");
    expect(slugifyTerm("YAML")).toBe("yaml");
    expect(slugifyTerm("Module / kind")).toBe("module-kind");
    expect(slugifyTerm("Anonymous vs. per-user")).toBe("anonymous-vs-per-user");
  });
});

describe("withBase", () => {
  it("joins with and without trailing slash on the base", () => {
    expect(withBase("/", "glossary#x")).toBe("/glossary#x");
    expect(withBase("/docs", "glossary#x")).toBe("/docs/glossary#x");
    expect(withBase("/docs/", "glossary#x")).toBe("/docs/glossary#x");
  });
});

const FIXTURE = `# Glossary (teacher-word → app-word)

Preamble prose that is not an entry.

- **Activity**: one thing you build for students: a tutor, a quiz, a writing task,
  or a coding endpoint. Defined by a YAML file.
- **Module / kind**: which sort of activity a code runs (tutor, quiz, writing,
  coding). Frozen when the code is created.
- **Prompt** (LLM sense): the instructions that tell the AI how to behave. In
  Novedu you configure activities by *writing prompts*, not by training a model.
`;

describe("parseGlossary", () => {
  const entries = parseGlossary(FIXTURE);

  it("skips the preamble and finds every bullet", () => {
    expect(entries.map((e) => e.term)).toEqual(["Activity", "Module / kind", "Prompt"]);
  });

  it("joins hard-wrapped definition lines", () => {
    expect(entries[0]?.definition).toBe(
      "one thing you build for students: a tutor, a quiz, a writing task, or a coding endpoint. Defined by a YAML file.",
    );
  });

  it("keeps the qualifier out of term and slug, and keeps inline markdown", () => {
    const prompt = entries[2];
    expect(prompt?.term).toBe("Prompt");
    expect(prompt?.qualifier).toBe("(LLM sense)");
    expect(prompt?.slug).toBe("prompt");
    expect(prompt?.definition).toContain("*writing prompts*");
  });

  it("throws on a bullet that does not match the contract instead of dropping it", () => {
    expect(() =>
      parseGlossary("- **Draft** (a note) in writing: what the student types.\n"),
    ).toThrow(/does not match/);
    expect(() => parseGlossary("- plain bullet without a bold term\n")).toThrow(/does not match/);
  });
});

describe("buildLookup", () => {
  const entries = parseGlossary(FIXTURE);
  const lookup = buildLookup(entries);

  it("resolves canonical terms case-insensitively via lowercased keys", () => {
    expect(lookup.get("activity")?.term).toBe("Activity");
    expect(lookup.get("prompt")?.term).toBe("Prompt");
  });

  it("resolves slash-part aliases of composite terms", () => {
    expect(lookup.get("module")?.term).toBe("Module / kind");
    expect(lookup.get("kind")?.term).toBe("Module / kind");
    expect(lookup.get("module / kind")?.term).toBe("Module / kind");
  });

  it("throws on an ambiguous alias", () => {
    const clashing: GlossaryEntry[] = [
      { term: "Code", definition: "x", slug: "code" },
      { term: "Code / snippet", definition: "y", slug: "code-snippet" },
    ];
    expect(() => buildLookup(clashing)).toThrow(/ambiguous/);
  });

  it("throws when two terms collapse to the same anchor slug", () => {
    const colliding: GlossaryEntry[] = [
      { term: "Check-in", definition: "x", slug: slugifyTerm("Check-in") },
      { term: "Check in", definition: "y", slug: slugifyTerm("Check in") },
    ];
    expect(() => buildLookup(colliding)).toThrow(/same anchor/);
  });
});

describe("normalizeTermKey", () => {
  it("collapses hard-wrap whitespace so wrapped markers still resolve", () => {
    expect(normalizeTermKey("anonymous vs.\n  per-user")).toBe("anonymous vs. per-user");
  });
});

function paragraph(text: string): Root {
  return {
    type: "root",
    children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
  };
}

function transformWith(tree: Root, base?: string): Root {
  const lookup = buildLookup(parseGlossary(FIXTURE));
  remarkGlossaryTerms({ base, loadLookup: () => lookup })(tree);
  return tree;
}

describe("remarkGlossaryTerms", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("turns [[term]] into a glossary link and keeps surrounding text", () => {
    const tree = transformWith(paragraph("An [[activity]] is one thing."));
    const children = (tree.children[0] as Paragraph).children;
    expect(children).toHaveLength(3);
    expect(children[0]).toMatchObject({ type: "text", value: "An " });
    expect(children[1]).toMatchObject({
      type: "link",
      url: "/glossary#activity",
      children: [{ type: "text", value: "activity" }],
    });
    expect(children[2]).toMatchObject({ type: "text", value: " is one thing." });
  });

  it("prefixes links with the configured base", () => {
    const tree = transformWith(paragraph("An [[activity]]."), "/docs");
    const children = (tree.children[0] as Paragraph).children;
    expect(children[1]).toMatchObject({ type: "link", url: "/docs/glossary#activity" });
  });

  it("uses the shown text of [[term|shown]] and resolves slash aliases", () => {
    const tree = transformWith(paragraph("Pick the [[module|kind]] of activity."));
    const children = (tree.children[0] as Paragraph).children;
    expect(children[1]).toMatchObject({
      type: "link",
      url: "/glossary#module-kind",
      children: [{ type: "text", value: "kind" }],
    });
  });

  it("matches terms case-insensitively and across hard wraps", () => {
    const tree = transformWith(paragraph("[[Activity]] and [[module\n/ kind|kinds]]."));
    const children = (tree.children[0] as Paragraph).children;
    expect(children[0]).toMatchObject({ type: "link", url: "/glossary#activity" });
    expect(children[2]).toMatchObject({ type: "link", url: "/glossary#module-kind" });
  });

  it("renders an unknown term as plain text and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tree = transformWith(paragraph("A [[no-such-term|widget]] here."));
    const children = (tree.children[0] as Paragraph).children;
    expect(children.every((c) => c.type === "text")).toBe(true);
    expect(children.map((c) => (c.type === "text" ? c.value : "")).join("")).toBe("A widget here.");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[[no-such-term]]"));
  });

  it("renders a marker anywhere inside a link as plain text and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "/somewhere",
              children: [
                { type: "text", value: "read the " },
                { type: "emphasis", children: [{ type: "text", value: "[[activity]]" }] },
                { type: "text", value: " and [[prompt]] chapter" },
              ],
            },
          ],
        },
      ],
    };
    transformWith(tree);
    const link = (tree.children[0] as Paragraph).children[0];
    expect(JSON.stringify(link)).not.toContain('"link"'.repeat(2));
    expect(JSON.stringify(link)).not.toContain("glossary#");
    expect(JSON.stringify(link)).toContain("activity");
    expect(JSON.stringify(link)).toContain("prompt");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("inside a link"));
  });

  it("does not touch inline code or fenced code", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "inlineCode", value: "[[activity]]" }],
        },
        { type: "code", value: "[[activity]]" },
      ],
    };
    transformWith(tree);
    expect((tree.children[0] as Paragraph).children[0]).toMatchObject({
      type: "inlineCode",
      value: "[[activity]]",
    });
    expect(tree.children[1]).toMatchObject({ type: "code", value: "[[activity]]" });
  });

  it("handles multiple markers in one text node", () => {
    const tree = transformWith(paragraph("[[activity]] and [[prompt]]."));
    const children = (tree.children[0] as Paragraph).children;
    expect(children.map((c) => c.type)).toEqual(["link", "text", "link", "text"]);
  });
});
