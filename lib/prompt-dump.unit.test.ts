import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
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
  "lib/quiz-feedback-judge.ts",
  "lib/quiz-resolve.ts",
  "lib/writing-resolve.ts",
  "lib/coding-resolve.ts",
  // The eval format layer (docs/cli-eval.md) is bundled into the CLI too and calls
  // straight into the dump seam, so it lives under the identical purity rule.
  "lib/eval-schema.ts",
  "lib/eval-validate.ts",
];

/**
 * The roots of the transitive closure walk below. Everything but the dump seam itself is
 * a SEPARATE entry point into the CLI-bundled graph — reached from `cli/src/**` rather
 * than from the dump — so walking only the dump would leave it, and everything it adds,
 * unguarded: `lib/eval-validate.ts` CALLS the dump seam, and `lib/quiz-feedback-judge.ts`
 * is pulled in directly by the eval runner.
 */
const CLOSURE_ROOTS = ["lib/prompt-dump.ts", "lib/eval-validate.ts", "lib/quiz-feedback-judge.ts"];

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

  // The list-based checks above document the SEAM files; this walk closes the gap they
  // leave: modules the dump reaches only transitively (lib/coding-proxy.ts,
  // lib/quiz-yaml.ts, lib/quiz-types.ts, lib/tutors/**, lib/prompt-fragments/**) and
  // specifier forms the simple regex misses (relative paths like "./llm/model",
  // side-effect imports, `export … from` re-exports, dynamic `import()`). Both CLI
  // entry points into that graph are walked (`CLOSURE_ROOTS`).
  it("keeps the ENTIRE transitive import closure app-free and 'use server'-free", () => {
    // Repo-relative paths whose import — even type-only, even N levels deep — must fail
    // the guard. Matched against the RESOLVED path, so "./db", "@/lib/db" and
    // "../lib/db" are all the same offender.
    const FORBIDDEN: RegExp[] = [
      /^app\//, // pulls in app/mastra/scch.ts (top-level-await network call) sooner or later
      /^auth\.ts$/,
      /^lib\/db(\/|\.ts$)/,
      /^lib\/llm\/model\.ts$/,
      /^lib\/file-store\.ts$/,
      /^lib\/code-store\.ts$/,
      /^lib\/app-hosted-yaml\.ts$/,
      /^lib\/app-hosted-fetcher\.ts$/,
    ];

    /** Every static/dynamic/side-effect/re-export specifier in a module's source. */
    const importSpecifiers = (src: string): string[] =>
      [
        ...src.matchAll(/\bfrom\s+["']([^"']+)["']/g), // import/export … from "x"
        ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm), // import "x" (side effect)
        ...src.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g), // import("x")
      ].map((m) => m[1] ?? "");

    /**
     * Resolve a specifier to a repo-relative path. Bare package / node: specifiers
     * return null; an unresolvable repo path is still returned (exists: false) so the
     * FORBIDDEN check sees it either way.
     */
    const resolveImport = (
      spec: string,
      importerRel: string,
    ): { rel: string; exists: boolean } | null => {
      let base: string;
      if (spec.startsWith("@/")) base = spec.slice(2);
      else if (spec.startsWith(".")) base = join(dirname(importerRel), spec);
      else return null;
      base = normalize(base).replace(/\\/g, "/");
      for (const rel of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        const abs = join(REPO_ROOT, rel);
        if (existsSync(abs) && statSync(abs).isFile()) return { rel, exists: true };
      }
      return { rel: base, exists: false };
    };

    const visited = new Set<string>();
    const offenders: string[] = [];
    const queue = [...CLOSURE_ROOTS];
    while (queue.length > 0) {
      const rel = queue.pop() as string;
      if (visited.has(rel)) continue;
      visited.add(rel);
      const src = read(rel);
      if (/^\s*["']use server["']/m.test(src)) offenders.push(`${rel}: "use server"`);
      for (const spec of importSpecifiers(src)) {
        const target = resolveImport(spec, rel);
        if (!target) continue;
        if (FORBIDDEN.some((pattern) => pattern.test(target.rel))) {
          offenders.push(`${rel} → ${spec}`);
        } else if (target.exists && /\.tsx?$/.test(target.rel)) {
          queue.push(target.rel);
        }
      }
    }
    expect(offenders, `server-only reach from the dump seam:\n${offenders.join("\n")}`).toEqual([]);
    // Anti-vacuous sanity: the walk must have actually reached every documented seam
    // module (a broken resolver would otherwise make this test pass on nothing).
    for (const mod of PURE_MODULES) {
      expect(visited.has(mod), `${mod} was not reached by the import walk`).toBe(true);
    }
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
