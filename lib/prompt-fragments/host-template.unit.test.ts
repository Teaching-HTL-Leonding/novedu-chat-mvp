import { describe, expect, it } from "vitest";
import { parseHostPlacements, renderHostTemplate } from "./host-template";

// The host-template engine: AST extraction of inline `{{fragment}}` markers and the
// strict, isolated render. Pure and hermetic — no network, no fragment libraries.

describe("parseHostPlacements", () => {
  it("extracts a marker's ref, typed args, and 1-based position", () => {
    const { placements, errors } = parseHostPlacements(
      'intro\n{{fragment "shared.persona" level="beginner" strict=true topics=(array "loops" "arrays")}}\ntail',
    );
    expect(errors).toEqual([]);
    expect(placements).toHaveLength(1);
    const p = placements[0];
    if (!p) throw new Error("expected a placement");
    expect(p.ref).toBe("shared.persona");
    expect(p.args).toEqual({
      level: "beginner",
      strict: true,
      topics: ["loops", "arrays"],
    });
    expect(p.line).toBe(2);
    expect(p.column).toBe(1);
  });

  it("keeps multiple placements in textual order", () => {
    const { placements } = parseHostPlacements(
      '{{fragment "a.one"}}\nmiddle\n{{fragment "a.two"}}\n{{fragment "b.three"}}',
    );
    expect(placements.map((p) => p.ref)).toEqual(["a.one", "a.two", "b.three"]);
  });

  it("finds a marker nested inside a block helper", () => {
    const { placements } = parseHostPlacements('{{#if x}}{{fragment "a.one"}}{{/if}}');
    expect(placements.map((p) => p.ref)).toEqual(["a.one"]);
  });

  it("reports HOST_TEMPLATE_PARSE_ERROR with a regexed line for a malformed template", () => {
    const { placements, errors } = parseHostPlacements("ok\n{{fragment unclosed");
    expect(placements).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("HOST_TEMPLATE_PARSE_ERROR");
    expect(errors[0]?.line).toBe(2);
  });

  it("reports FRAGMENT_REF_NOT_LITERAL for a bare {{fragment}}", () => {
    const { errors } = parseHostPlacements("{{fragment}}");
    expect(errors.map((e) => e.code)).toEqual(["FRAGMENT_REF_NOT_LITERAL"]);
  });

  it("reports FRAGMENT_REF_NOT_LITERAL when the ref is not a quoted literal", () => {
    const { errors } = parseHostPlacements("{{fragment someVar}}");
    expect(errors.map((e) => e.code)).toEqual(["FRAGMENT_REF_NOT_LITERAL"]);
  });

  it("does not treat an escaped \\{{ as a marker", () => {
    const { placements, errors } = parseHostPlacements("literal \\{{fragment}} braces");
    expect(errors).toEqual([]);
    expect(placements).toEqual([]);
  });
});

describe("parseHostPlacements — structurally invalid markers (fail closed)", () => {
  // Each of these WOULD render differently than it validates (or lose text) if allowed,
  // so they must become FRAGMENT_MARKER_INVALID and record no placement.
  const invalid: [string, string][] = [
    ["a numeric hash argument", '{{fragment "a.b" count=5}}'],
    ["a path hash argument", '{{fragment "a.b" x=someVar}}'],
    ["an (array …) with a non-string element", '{{fragment "a.b" xs=(array "a" 1)}}'],
    ["a nested (fragment …) hash argument", '{{fragment "a.b" x=(fragment "c.d")}}'],
    ["extra positional arguments", '{{fragment "a.b" "typo"}}'],
    ["a block {{#fragment}} form", '{{#fragment "a.b"}}body{{/fragment}}'],
    ["a (fragment …) subexpression", '{{#if (fragment "a.b")}}x{{/if}}'],
  ];

  for (const [label, src] of invalid) {
    it(`rejects ${label} and records no placement`, () => {
      const { placements, errors } = parseHostPlacements(src);
      expect(errors.map((e) => e.code)).toContain("FRAGMENT_MARKER_INVALID");
      expect(placements).toEqual([]);
    });
  }
});

describe("renderHostTemplate", () => {
  const resolver = (ref: string, args: Record<string, unknown>) =>
    `[${ref}${Object.keys(args).length ? ` ${JSON.stringify(args)}` : ""}]`;

  it("replaces each marker in place and preserves surrounding text", () => {
    const out = renderHostTemplate('before\n{{fragment "a.one" k="v"}}\nafter', resolver);
    expect(out).toBe('before\n[a.one {"k":"v"}]\nafter');
  });

  it("renders a literal \\{{ back to {{ verbatim", () => {
    expect(renderHostTemplate("use \\{{mustache}} here", resolver)).toBe("use {{mustache}} here");
  });

  it("passes array subexpressions through as string arrays", () => {
    const out = renderHostTemplate('{{fragment "a.x" items=(array "p" "q")}}', resolver);
    expect(out).toBe('[a.x {"items":["p","q"]}]');
  });

  it("fails closed (throws) on a stray non-fragment mustache under strict mode", () => {
    // The render context is empty and only `fragment`/`array` helpers exist, so any
    // other `{{…}}` reference throws — never silently rendering empty.
    expect(() => renderHostTemplate("{{someUndeclaredThing}}", resolver)).toThrow();
  });

  it("propagates a resolver throw so the caller can fail closed", () => {
    expect(() =>
      renderHostTemplate('{{fragment "a.x"}}', () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });
});
