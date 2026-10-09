import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readModule } from "@/tests/import-graph";

// Test-suite conventions a reviewer cannot be expected to spot (docs/testing.md,
// "House conventions").
const testFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "*.test.ts", "*.test.tsx"],
  {
    cwd: REPO_ROOT,
    encoding: "utf8",
  },
)
  .split("\n")
  // --cached still lists a file deleted in the working tree but not yet staged.
  .filter((file) => file && existsSync(join(REPO_ROOT, file)));

describe("guard: test conventions", () => {
  it("no test writes process.env directly — a vi.stubEnv is reset before every test, a write is not", () => {
    const offenders = testFiles.filter((file) =>
      /process\.env(\.\w+|\[[^\]]+\])\s*=(?!=)|delete process\.env/.test(readModule(file)),
    );
    expect(offenders).toEqual([]);
  });
});
