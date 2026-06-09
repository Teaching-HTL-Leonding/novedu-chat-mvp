import { describe, expect, it } from "vitest";
import { assembleSystemPrompt } from "./assemble";
import { checkConsistency, type ResolvedFragment } from "./consistency";
import type { Tutor } from "./schemas";
import { loadRealFragmentFiles, loadRealTutor } from "./test-fixtures";

function realPlan(): { plan: ResolvedFragment[]; tutor: Tutor } {
  const tutor = loadRealTutor();
  const { plan, errors } = checkConsistency(tutor, loadRealFragmentFiles());
  if (errors.length) throw new Error("precondition: real sample must be consistent");
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

describe("assembleSystemPrompt — real sample", () => {
  it("orders fragments by priority and appends tutor_instructions last", () => {
    const { plan, tutor } = realPlan();
    const out = assembleSystemPrompt(plan, tutor);

    const socratic = out.indexOf("Socratic tutor for linked list data structures");
    const safety = out.indexOf("The student may be a school child");
    const instructions = out.indexOf(
      "You are a Socratic tutor specializing in linked list data structures",
    );

    expect(socratic).toBeGreaterThanOrEqual(0);
    expect(safety).toBeGreaterThan(socratic); // priority 900 after priority 100
    expect(instructions).toBeGreaterThan(safety); // tutor_instructions last
  });

  it("renders the supplied concepts and ASCII diagram verbatim", () => {
    const { plan, tutor } = realPlan();
    const out = assembleSystemPrompt(plan, tutor);
    expect(out).toContain("singly linked lists vs. doubly linked lists");
    expect(out).toContain("[head] -> [ A");
  });

  it("renders a fragment's default when the tutor omits the variable", () => {
    // End-to-end: an optional `{{greeting}}` with a default, not supplied by the tutor.
    // checkConsistency must inject the default so the strict renderer doesn't throw.
    const tutor = loadRealTutor();
    const files = loadRealFragmentFiles();
    const frag = files.get("general_fragments")?.fragments.find((f) => f.id === "socratic_tutor");
    if (frag?.input_schema) {
      frag.input_schema.properties.greeting = { type: "string", default: "Hello from default" };
      frag.content = `${frag.content}\n\nGreeting: {{greeting}}`;
    }
    const { plan, errors } = checkConsistency(tutor, files);
    expect(errors).toEqual([]);
    expect(assembleSystemPrompt(plan, tutor)).toContain("Greeting: Hello from default");
  });
});
