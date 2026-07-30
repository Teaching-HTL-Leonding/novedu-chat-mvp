import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The isolation invariant (see docs/prompt-fragments.md): ALL Handlebars handling —
// compilation, COMPILE_OPTIONS, consistency, assembly — lives ONLY in
// `lib/prompt-fragments/`. No activity module (tutor / quiz / writing / coding) may
// import `handlebars` or re-implement any of it. This grep-guard fails the build if a
// future change copies template handling into `lib/quiz-*` / `lib/writing-*` /
// `lib/coding-*` (or anywhere else outside the shared module).

const REPO_ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app", "cli"];
const ALLOWED_DIR = join("lib", "prompt-fragments");
const IGNORE = new Set(["node_modules", "dist", ".next", ".turbo"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry)) {
      yield full;
    }
  }
}

function filesMatching(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const dirName of SCAN_DIRS) {
    const dir = join(REPO_ROOT, dirName);
    for (const file of walk(dir)) {
      if (pattern.test(readFileSync(file, "utf8"))) {
        hits.push(relative(REPO_ROOT, file));
      }
    }
  }
  return hits;
}

const isAllowed = (relPath: string) => relPath.startsWith(ALLOWED_DIR);

describe("prompt-fragment isolation invariant", () => {
  it("imports `handlebars` ONLY from files under lib/prompt-fragments/", () => {
    const importers = filesMatching(/from ["']handlebars["']|require\(["']handlebars["']\)/);
    // Sanity: the three real importers (assemble.ts, fragment.ts, host-template.ts) must
    // be present, so a false-negative regex can't make the guard vacuously pass.
    expect(importers.length).toBeGreaterThanOrEqual(3);
    const offenders = importers.filter((f) => !isAllowed(f));
    expect(
      offenders,
      `handlebars imported outside lib/prompt-fragments/: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("references COMPILE_OPTIONS ONLY from files under lib/prompt-fragments/", () => {
    const users = filesMatching(/\bCOMPILE_OPTIONS\b/);
    const offenders = users.filter((f) => !isAllowed(f));
    expect(
      offenders,
      `COMPILE_OPTIONS referenced outside lib/prompt-fragments/: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps lib/llm/endpoint.ts provider-blind and side-effect-free (no Handlebars / Fetcher / scch / fragment assembly)", () => {
    // The coding proxy resolves fragments in the load layer, never in endpoint.ts —
    // which must not import Handlebars, a Fetcher, app/mastra/scch.ts, or the
    // fragment orchestrator (see docs/coding.md).
    const src = readFileSync(join(REPO_ROOT, "lib", "llm", "endpoint.ts"), "utf8");
    expect(src).not.toMatch(/from ["']handlebars["']/);
    // Must not IMPORT the Mastra-coupled `app/mastra/scch.ts` (the side-effect-free
    // `lib/scch-endpoint`, which endpoint.ts legitimately uses, is fine). Match import
    // specifiers only, so the invariant comment naming the file doesn't trip the guard.
    expect(src).not.toMatch(/from ["'][^"']*mastra\/scch/);
    expect(src).not.toMatch(/assembleFragmentPrompt|COMPILE_OPTIONS/);
  });
});
