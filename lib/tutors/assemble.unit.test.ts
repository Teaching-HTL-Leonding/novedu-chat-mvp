import { describe, expect, it } from "vitest";
import { renderFragmentContent } from "@/lib/prompt-fragments";

// `renderFragmentContent` renders ONE fragment's content against its resolved
// variables, with the exact strict + noEscape compile options real assembly uses.
// The end-to-end host-template placement/ordering behaviour is covered in
// `load.unit.test.ts` (via `assembleFragmentPrompt`).

describe("renderFragmentContent — templating", () => {
  it("interpolates {{var}}", () => {
    expect(renderFragmentContent("Tutor for {{domain}}.", { domain: "trees" })).toBe(
      "Tutor for trees.",
    );
  });

  it("expands {{#each}} into one line per item", () => {
    const out = renderFragmentContent("Items:\n{{#each xs}}\n- {{this}}\n{{/each}}", {
      xs: ["a", "b", "c"],
    });
    expect(out).toContain("- a");
    expect(out).toContain("- b");
    expect(out).toContain("- c");
  });

  it("honors {{#unless bool}} in both directions", () => {
    const tpl = "{{#unless allow}}Do not provide a solution.{{/unless}}";
    expect(renderFragmentContent(tpl, { allow: false })).toContain("Do not provide a solution.");
    expect(renderFragmentContent(tpl, { allow: true })).not.toContain("Do not provide a solution.");
  });

  it("does NOT HTML-escape output (noEscape) — ASCII diagrams survive", () => {
    const out = renderFragmentContent("null <- [ A ] -> [ B ] & done", {});
    expect(out).toContain("<-");
    expect(out).toContain("->");
    expect(out).toContain("&");
    expect(out).not.toContain("&lt;");
    expect(out).not.toContain("&amp;");
  });

  it("throws when a template references a missing variable (strict backstop)", () => {
    expect(() => renderFragmentContent("{{missing}}", {})).toThrow();
  });

  it("fails closed when a fragment's content tries to call {{fragment}} itself (no nesting)", () => {
    // `renderFragmentContent` uses the DEFAULT Handlebars instance, which has no
    // `fragment` helper — so a fragment cannot recursively place another fragment; it
    // throws instead. Guards the isolation between the two Handlebars instances.
    expect(() => renderFragmentContent('{{fragment "shared.persona"}}', {})).toThrow();
  });
});
