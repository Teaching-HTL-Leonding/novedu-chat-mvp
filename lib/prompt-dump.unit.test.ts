import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROMPT_KINDS, promptDumpers, verdictResponseJsonSchema } from "@/lib/prompt-dump";

// Two things this file guards, both of which would silently break `novedu-cli prompts`:
//
//  1. PURITY — the dump seam and the pure modules it reaches for must never import
//     `app/**` (whose graph pulls in `app/mastra/scch.ts`, a top-level `await` network
//     call at IMPORT time, via `lib/llm/model.ts`), the database, or a `"use server"`
//     directive. A grep-guard in the spirit of `prompt-fragments/isolation.unit.test.ts`.
//  2. NO SECOND IMPLEMENTATION — `lib/quiz-actions.ts` and `lib/code-modules/quiz.ts`
//     must IMPORT the extracted prompt builders, never redefine them, or a dumped prompt
//     would drift from the one production sends.

const REPO_ROOT = join(__dirname, "..");

const read = (relPath: string) => readFileSync(join(REPO_ROOT, relPath), "utf8");

/** Every module the CLI's prompt dump pulls in that must stay app-free. */
const PURE_MODULES = [
  "lib/prompt-dump.ts",
  "lib/quiz-grading-prompt.ts",
  "lib/quiz-discussion-prompt.ts",
  "lib/quiz-verdict-schema.ts",
  "lib/quiz-resolve.ts",
  "lib/writing-resolve.ts",
  "lib/coding-resolve.ts",
];

describe("prompt-dump purity invariant", () => {
  it.each(PURE_MODULES)("%s imports nothing from app/ or the DB", (relPath) => {
    const src = read(relPath);
    // Import specifiers only, so a prose mention of the offending path in a comment
    // (there are several, explaining WHY) does not trip the guard.
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    const offenders = specifiers.filter(
      (s) =>
        s.startsWith("@/app/") ||
        s.startsWith("../app/") ||
        s === "@/auth" ||
        s.startsWith("@/lib/db") ||
        s === "@/lib/llm/model" ||
        s === "@/lib/file-store" ||
        s === "@/lib/code-store" ||
        s === "@/lib/app-hosted-yaml" ||
        s === "@/lib/app-hosted-fetcher",
    );
    expect(offenders, `${relPath} imports server-only modules: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it.each(PURE_MODULES)("%s carries no 'use server' directive", (relPath) => {
    expect(read(relPath)).not.toMatch(/^\s*["']use server["']/m);
  });

  it("exposes exactly one dumper per prompt-producing FileKind", () => {
    expect(Object.keys(promptDumpers).sort()).toEqual([...PROMPT_KINDS].sort());
  });
});

describe("no second implementation of the quiz prompts", () => {
  it("lib/quiz-actions.ts imports the grading prompt instead of defining one", () => {
    const src = read("lib/quiz-actions.ts");
    expect(src).toMatch(/from "@\/lib\/quiz-grading-prompt"/);
    expect(src).not.toMatch(/function buildGradingPrompt/);
    // The user-message wrappers come from the same module (the dump emits them).
    expect(src).toMatch(/\bbuildAnswerMessage\b/);
    expect(src).not.toMatch(/The student's answer:/);
  });

  it("lib/quiz-actions.ts seeds discussions from the shared templates", () => {
    const src = read("lib/quiz-actions.ts");
    expect(src).toMatch(/from "@\/lib\/quiz-discussion-prompt"/);
    expect(src).not.toMatch(/Answer the following question:/);
    expect(src).not.toMatch(/Your answer is \$\{/);
  });

  it("lib/code-modules/quiz.ts imports the discussion prompt instead of defining one", () => {
    const src = read("lib/code-modules/quiz.ts");
    expect(src).toMatch(/from "@\/lib\/quiz-discussion-prompt"/);
    expect(src).not.toMatch(/function buildDiscussionInstructions/);
  });

  it("app/mastra/quiz-agents.ts re-exports the verdict schema from the pure module", () => {
    const src = read("app/mastra/quiz-agents.ts");
    expect(src).toMatch(/export \{ QUIZ_VERDICT_SCHEMA \} from "@\/lib\/quiz-verdict-schema"/);
    expect(src).not.toMatch(/QUIZ_VERDICT_SCHEMA = z\.object/);
  });
});

describe("verdictResponseJsonSchema", () => {
  it("is the grader's `{ result, feedback }` contract as plain JSON Schema", () => {
    const schema = verdictResponseJsonSchema();
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        result: { type: "string", enum: ["correct", "partial", "incorrect"] },
        feedback: { type: "string" },
      },
      required: ["result", "feedback"],
    });
    // Plain JSON — the eval harness must be able to `JSON.stringify` it as-is.
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});
