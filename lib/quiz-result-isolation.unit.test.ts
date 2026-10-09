import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { importSpecifiers, REPO_ROOT, resolveImport } from "@/tests/import-graph";

// Saved quiz results have NO teacher surface by construction (docs/home.md →
// Saving a quiz result): lib/quiz-result-store.ts is the only access to
// `novedu_quiz_results`, and only the student's own paths import it — the save
// action, the start page's facts, the Settings page and its actions, and the
// code-delete path (whose helper returns nothing). A new importer — a route
// handler, a bearer endpoint, a teacher page — must fail here first.

const STORE = "lib/quiz-result-store.ts";

const ALLOWED_IMPORTERS = [
  "app/settings/page.tsx",
  "lib/code-stats-store.ts",
  "lib/quiz-actions.ts",
  "lib/student-facts-store.ts",
  "lib/user-settings-actions.ts",
];

// The table object and its name: only the schema and the store spell them.
const TABLE_OWNERS = ["lib/db/schema.ts", STORE];

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(join(REPO_ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(REPO_ROOT, rel)).isDirectory()) yield* sources(rel);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield rel;
  }
}

const production = [...sources("lib"), ...sources("app")].map((rel) => ({
  rel: relative(REPO_ROOT, join(REPO_ROOT, rel)),
  source: readFileSync(join(REPO_ROOT, rel), "utf8"),
}));

describe("guard: saved quiz results have no reader but the student's own paths", () => {
  it("only the student's own paths import the quiz-result store", () => {
    const importers = production
      .filter(({ rel, source }) =>
        importSpecifiers(source).some((spec) => resolveImport(rel, spec).rel === STORE),
      )
      .map(({ rel }) => rel)
      .sort();
    expect(importers).toEqual(ALLOWED_IMPORTERS);
  });

  it("no other module names the table object or the table", () => {
    const offenders = production
      .filter(({ rel }) => !TABLE_OWNERS.includes(rel))
      .filter(({ source }) => /\bquizResults\b|novedu_quiz_results/.test(source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
