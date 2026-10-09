import { describe, expect, it } from "vitest";
import { importSpecifiers, readModule, resolveImport, sourceFiles } from "@/tests/import-graph";

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

describe("guard: the tutor history store has no reader but the token-gated paths", () => {
  it("only the tutor actions, the snapshot runner and the history gate import it", () => {
    const importers = sourceFiles("lib", "app", "components")
      .filter((rel) =>
        importSpecifiers(readModule(rel)).some((spec) => resolveImport(rel, spec).rel === STORE),
      )
      .sort();
    expect(importers).toEqual(ALLOWED_IMPORTERS);
  });
});
