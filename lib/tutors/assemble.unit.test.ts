import { describe, expect, it } from "vitest";
import {
  assembleSystemPrompt,
  checkConsistency,
  type ResolvedFragment,
} from "@/lib/prompt-fragments";
import { loadFixtureFragmentFiles, loadFixtureTutor } from "./test-fixtures";

function fixturePlan(): { plan: ResolvedFragment[]; instructions: string } {
  const tutor = loadFixtureTutor();
  const { plan, errors } = checkConsistency(tutor.prompt, loadFixtureFragmentFiles());
  if (errors.length) throw new Error("precondition: fixture must be consistent");
  return { plan, instructions: tutor.prompt.tutor_instructions };
}

function frag(content: string, variables: ResolvedFragment["variables"] = {}): ResolvedFragment {
  return { fileAlias: "f", fragmentId: "id", priority: 1, content, variables };
}

describe("assembleSystemPrompt — templating", () => {
  it("interpolates {{var}}", () => {
    const out = assembleSystemPrompt([frag("Tutor for {{domain}}.", { domain: "trees" })], "");
    expect(out).toContain("Tutor for trees.");
  });

  it("expands {{#each}} into one line per item", () => {
    const out = assembleSystemPrompt(
      [frag("Items:\n{{#each xs}}\n- {{this}}\n{{/each}}", { xs: ["a", "b", "c"] })],
      "",
    );
    expect(out).toContain("- a");
    expect(out).toContain("- b");
    expect(out).toContain("- c");
  });

  it("honors {{#unless bool}} in both directions", () => {
    const tpl = "{{#unless allow}}Do not provide a solution.{{/unless}}";
    expect(assembleSystemPrompt([frag(tpl, { allow: false })], "")).toContain(
      "Do not provide a solution.",
    );
    expect(assembleSystemPrompt([frag(tpl, { allow: true })], "")).not.toContain(
      "Do not provide a solution.",
    );
  });

  it("does NOT HTML-escape output (noEscape) — ASCII diagrams survive", () => {
    const out = assembleSystemPrompt([frag("null <- [ A ] -> [ B ] & done")], "");
    expect(out).toContain("<-");
    expect(out).toContain("->");
    expect(out).toContain("&");
    expect(out).not.toContain("&lt;");
    expect(out).not.toContain("&amp;");
  });

  it("throws when a template references a missing variable (strict backstop)", () => {
    expect(() => assembleSystemPrompt([frag("{{missing}}")], "")).toThrow();
  });

  it("renders a fragment-only preamble (no trailing text) and an empty plan to the empty string", () => {
    expect(assembleSystemPrompt([frag("Just a fragment.")])).toContain("Just a fragment.");
    expect(assembleSystemPrompt([])).toBe("");
  });
});

describe("assembleSystemPrompt — fixture", () => {
  it("orders fragments by priority and appends the trailing instructions last", () => {
    const { plan, instructions } = fixturePlan();
    const out = assembleSystemPrompt(plan, instructions);

    const first = out.indexOf("FIRST-MARKER");
    const last = out.indexOf("LAST-MARKER");
    const trailing = out.indexOf("TUTOR-INSTRUCTIONS-MARKER");

    expect(first).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(first); // priority 60 after priority 10
    expect(trailing).toBeGreaterThan(last); // trailing instructions last
  });

  it("renders the supplied items and ASCII diagram verbatim", () => {
    const { plan, instructions } = fixturePlan();
    const out = assembleSystemPrompt(plan, instructions);
    expect(out).toContain("ITEM-ALPHA");
    expect(out).toContain("[head] -> [ A");
  });

  it("renders a fragment's default when the tutor omits the variable", () => {
    // End-to-end: an optional `{{greeting}}` with a default, not supplied by the tutor.
    // checkConsistency must inject the default so the strict renderer doesn't throw.
    const tutor = loadFixtureTutor();
    const files = loadFixtureFragmentFiles();
    const frag = files.get("lib_a")?.fragments.find((f) => f.id === "str_frag");
    if (frag?.input_schema) {
      frag.input_schema.properties.greeting = { type: "string", default: "Hello from default" };
      frag.content = `${frag.content}\n\nGreeting: {{greeting}}`;
    }
    const { plan, errors } = checkConsistency(tutor.prompt, files);
    expect(errors).toEqual([]);
    expect(assembleSystemPrompt(plan, tutor.prompt.tutor_instructions)).toContain(
      "Greeting: Hello from default",
    );
  });
});
