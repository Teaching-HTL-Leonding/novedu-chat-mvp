import { readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { REPO_ROOT, readModule, sourceFiles } from "@/tests/import-graph";

// AGENTS.md security block (docs/auth.md "Student mode"): teacher-only work is gated
// by requireEffectiveTeacher()/requireTeacherUserId() from lib/student-mode.ts. A
// requireTeacher() call or a raw `.isTeacher` read ignores "view as student", so both
// are confined to the files below. Known blind spot: a destructuring read
// (`const { isTeacher } = session.user`) has no `.isTeacher` and is not caught.

const ALLOWED: Record<string, string> = {
  "lib/session.ts": "defines requireTeacher(), the raw-role check",
  "lib/student-mode.ts": "teacherViewForSession, the one student-mode-aware reader",
  "lib/student-mode-actions.ts": "requireTeacher() gates ENTERING student mode",
  "lib/api-auth.ts": "bearer channel (no student mode) reads novedu_user.is_teacher",
  "app/api/me/route.ts": "bearer identity probe echoes the bearer user's role",
  "components/user-menu.tsx": "reads its prop, already the EFFECTIVE role (status-bar.tsx)",
};

const RAW_ROLE = /\brequireTeacher\s*\(|\.isTeacher\b/;

// Comments may name the forbidden forms (to warn against them); code may not.
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

it("only the allow-listed files call requireTeacher() or read .isTeacher", () => {
  const rootFiles = readdirSync(REPO_ROOT).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
  );
  const files = [...sourceFiles("app", "lib", "components"), ...rootFiles];
  const hits = files.filter((file) => RAW_ROLE.test(stripComments(readModule(file))));

  // Positive control: every allow-listed file is still a real hit, so the scan works
  // and the list cannot rot into blanket exemptions.
  expect(hits.filter((file) => file in ALLOWED).sort()).toEqual(Object.keys(ALLOWED).sort());
  expect(hits.filter((file) => !(file in ALLOWED))).toEqual([]);
});
