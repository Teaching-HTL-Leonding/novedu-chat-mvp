import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, walkClosure } from "../../tests/import-graph";

// lib/limits/** reads the environment (`LIMITS_ENABLED`) and is a server-side
// product policy — the @novedu/cli bundle must stay env-free and never carry a
// copy of it (docs/usage-metering.md "Limits"). This guard walks the ENTIRE
// transitive import closure of `cli/src/**` and fails if it reaches any module
// under lib/limits/. The coding proxy's pure helpers (lib/coding-proxy.ts) sit
// in that closure, which is why the clamp takes its cap as a parameter.

const IGNORE = new Set(["node_modules", "dist", ".next"]);
const FORBIDDEN = /^lib\/limits\//;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) yield full;
  }
}

describe("limits isolation", () => {
  it("cli/src's transitive import closure never reaches lib/limits", () => {
    const roots = [...walk(join(REPO_ROOT, "cli", "src"))].map((f) =>
      relative(REPO_ROOT, f).replace(/\\/g, "/"),
    );
    expect(roots.length).toBeGreaterThanOrEqual(20);

    const offenders: string[] = [];
    const visited = walkClosure(roots, ({ rel, imports }) => {
      const next: string[] = [];
      for (const { rel: target } of imports) {
        if (target === null) continue;
        if (FORBIDDEN.test(target)) offenders.push(`${rel} → ${target}`);
        else next.push(target);
      }
      return next;
    });
    // Sanity: the walk crossed into the shared lib/ code, incl. the coding proxy helpers.
    expect(visited.has("lib/coding-proxy.ts")).toBe(true);
    expect(offenders, `lib/limits reachable from the CLI: ${offenders.join(", ")}`).toEqual([]);
  });
});
