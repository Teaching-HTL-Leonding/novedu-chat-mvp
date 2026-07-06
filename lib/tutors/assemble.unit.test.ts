import { describe, expect, it } from "vitest";
import { assembleSystemPrompt } from "./assemble";
import { checkConsistency, type ResolvedFragment } from "./consistency";
import type { Tutor } from "./schemas";
import { loadFixtureFragmentFiles, loadFixtureTutor } from "./test-fixtures";

function fixturePlan(): { plan: ResolvedFragment[]; tutor: Tutor } {
  const tutor = loadFixtureTutor();
  const { plan, errors } = checkConsistency(tutor, loadFixtureFragmentFiles());
  if (errors.length) throw new Error("precondition: fixture must be consistent");
  return { plan, tutor };
}

const minimalTutor = (instructions: string): Tutor =>
  ({ prompt: { tutor_instructions: instructions } }) as unknown as Tutor;

function frag(content: string, variables: ResolvedFragment["variables"] = {}): ResolvedFragment {
  return { fileAlias: "f", fragmentId: "id", priority: 1, content, variables };
}

describe("assembleSystemPrompt — templating", () => {
  it("interpolates {{var}}", () => {
    const out = assembleSystemPrompt(
      [frag("Tutor for {{domain}}.", { domain: "trees" })],
      minimalTutor(""),
    );
    expect(out).toContain("Tutor for trees.");
  });

  it("expands {{#each}} into one line per item", () => {
    const out = assembleSystemPrompt(
      [frag("Items:\n{{#each xs}}\n- {{this}}\n{{/each}}", { xs: ["a", "b", "c"] })],
      minimalTutor(""),
    );
    expect(out).toContain("- a");
    expect(out).toContain("- b");
    expect(out).toContain("- c");
  });

  it("honors {{#unless bool}} in both directions", () => {
    const tpl = "{{#unless allow}}Do not provide a solution.{{/unless}}";
    expect(assembleSystemPrompt([frag(tpl, { allow: false })], minimalTutor(""))).toContain(
      "Do not provide a solution.",
    );
    expect(assembleSystemPrompt([frag(tpl, { allow: true })], minimalTutor(""))).not.toContain(
      "Do not provide a solution.",
    );
  });

  it("does NOT HTML-escape output (noEscape) — ASCII diagrams survive", () => {
    const out = assembleSystemPrompt([frag("null <- [ A ] -> [ B ] & done")], minimalTutor(""));
    expect(out).toContain("<-");
    expect(out).toContain("->");
    expect(out).toContain("&");
    expect(out).not.toContain("&lt;");
    expect(out).not.toContain("&amp;");
  });

  it("throws when a template references a missing variable (strict backstop)", () => {
    expect(() => assembleSystemPrompt([frag("{{missing}}")], minimalTutor(""))).toThrow();
  });
});

describe("assembleSystemPrompt — fixture", () => {
  it("orders fragments by priority and appends tutor_instructions last", () => {
    const { plan, tutor } = fixturePlan();
    const out = assembleSystemPrompt(plan, tutor);

    const first = out.indexOf("FIRST-MARKER");
    const last = out.indexOf("LAST-MARKER");
    const instructions = out.indexOf("TUTOR-INSTRUCTIONS-MARKER");

    expect(first).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(first); // priority 60 after priority 10
    expect(instructions).toBeGreaterThan(last); // tutor_instructions last
  });

  it("renders the supplied items and ASCII diagram verbatim", () => {
    const { plan, tutor } = fixturePlan();
    const out = assembleSystemPrompt(plan, tutor);
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
    const { plan, errors } = checkConsistency(tutor, files);
    expect(errors).toEqual([]);
    expect(assembleSystemPrompt(plan, tutor)).toContain("Greeting: Hello from default");
  });
});
