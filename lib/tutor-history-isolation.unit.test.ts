// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { importSpecifiers, REPO_ROOT, resolveImport } from "@/tests/import-graph";

// lib/tutor-history-store.ts reads students' tutor conversations straight out of
// Mastra's tables and the student-side view of `novedu_user_chats`. Its only
// callers run behind the session (and, for messages, the thread-token proof over
// (code, session user, thread)): the tutor actions, the runtime route's snapshot
// runner, and the shared history gate whose ownership branch they both use. A
// new importer (a route handler, a bearer endpoint, a teacher page) must fail
// here first.

const STORE = "lib/tutor-history-store.ts";

const ALLOWED_IMPORTERS = [
  "app/api/copilotkit/history-snapshot-runner.ts",
  "lib/tutor-actions.ts",
  "lib/tutor-history-gate.ts",
];

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(join(REPO_ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(REPO_ROOT, rel)).isDirectory()) yield* sources(rel);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield rel;
  }
}

describe("guard: the tutor history store has no reader but the token-gated paths", () => {
  it("only the tutor actions, the snapshot runner and the history gate import it", () => {
    const importers = [...sources("lib"), ...sources("app"), ...sources("components")]
      .map((rel) => ({
        rel: relative(REPO_ROOT, join(REPO_ROOT, rel)),
        source: readFileSync(join(REPO_ROOT, rel), "utf8"),
      }))
      .filter(({ rel, source }) =>
        importSpecifiers(source).some((spec) => resolveImport(rel, spec).rel === STORE),
      )
      .map(({ rel }) => rel)
      .sort();
    expect(importers).toEqual(ALLOWED_IMPORTERS);
  });
});
