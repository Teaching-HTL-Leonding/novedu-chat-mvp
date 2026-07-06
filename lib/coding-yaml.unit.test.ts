import { describe, expect, it } from "vitest";
import { parseCoding } from "@/lib/coding-yaml";

// The lenient coding YAML parser (mirrors lib/writing-yaml's parser). It requires
// only `llm.model` + `instructions`; everything else is optional. There is no
// `anonymous` field — a coding activity is always anonymous. (Parsing a full
// on-disk sample is covered by the CLI validate test over test-fixtures/.)

const VALID = `
id: beginner-typescript
name: "Beginner TypeScript Coding Buddy"
title: "TypeScript Coding Buddy (Beginners)"
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
instructions: |
  You are a friendly TypeScript coding buddy. Use only primitive types.
`;

describe("parseCoding", () => {
  it("parses a complete coding activity", () => {
    const result = parseCoding(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.coding;
    expect(c.title).toBe("TypeScript Coding Buddy (Beginners)");
    expect(c.model).toBe("RedHatAI/gemma-4-31B-it-FP8-Dynamic");
    expect(c.instructions).toContain("primitive types");
  });

  it("is lenient — only llm.model and instructions are required", () => {
    const result = parseCoding("llm:\n  model: m\ninstructions: Help.\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coding.title).toBeUndefined();
  });

  it("defaults a missing llm.provider to SCCH and carries an explicit one", () => {
    const defaulted = parseCoding("llm:\n  model: m\ninstructions: Help.\n");
    expect(defaulted.ok && defaulted.coding.provider).toBe("SCCH");
    const foundry = parseCoding(
      "llm:\n  model: gpt-5.4-mini\n  provider: Azure Foundry\ninstructions: Help.\n",
    );
    expect(foundry.ok && foundry.coding.provider).toBe("Azure Foundry");
  });

  it("rejects an unsupported llm.provider instead of silently using SCCH", () => {
    const result = parseCoding("llm:\n  model: m\n  provider: OpenAI\ninstructions: Help.\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("llm.provider");
  });

  it.each([
    ["invalid YAML", ":::not yaml::: ["],
    ["missing model", "instructions: Help.\n"],
    ["missing instructions", "llm:\n  model: m\n"],
  ])("rejects %s with a friendly message", (_label, content) => {
    const result = parseCoding(content);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.message).toBe("string");
  });
});
