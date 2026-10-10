import { readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { REPO_ROOT, readModule, sourceFiles } from "@/tests/import-graph";

// The build-time sign-in switch (docs/auth.md, "Demo mode"). NOVEDU_AUTH_MODE is read
// in next.config.ts (through lib/auth-mode.ts) and branched on only by the files
// below, each with the literal `process.env.NOVEDU_AUTH_MODE === "demo"` the bundler
// folds; and the demo-only modules are loaded only by `await import()` inside such a
// branch — a static import would ship them (or a client reference to them) in an
// Entra build whether or not the branch runs.

const MODE_READERS: Record<string, string> = {
  "next.config.ts": "parses and emits the mode (config.env)",
  "lib/auth-mode.ts": "the parser",
  "auth.ts": "picks the options factory",
  "instrumentation.ts": "the demo boot, the preflight mode, the seed",
  "app/api/auth/[...all]/route.ts": "the demo allowlist",
  "app/sign-in/page.tsx": "the demo sign-in buttons",
  "app/layout.tsx": "the DEMO ribbon",
};

// Demo-only modules. `lib/auth-demo-options.ts` is the one sanctioned static import
// (auth.ts builds the instance synchronously); it is inert configuration.
const DEMO_MODULES = [
  "lib/demo-personas",
  "lib/demo-boot",
  "lib/demo-seed",
  "lib/auth-demo-allowlist",
  "app/sign-in/demo-sign-in",
  "components/demo-ribbon",
];

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

function appFiles(): string[] {
  const rootFiles = readdirSync(REPO_ROOT).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
  );
  return [...sourceFiles("app", "lib", "components"), ...rootFiles];
}

it("only the allow-listed files read NOVEDU_AUTH_MODE", () => {
  const hits = appFiles().filter((file) =>
    /NOVEDU_AUTH_MODE/.test(stripComments(readModule(file))),
  );
  expect(hits.sort()).toEqual(Object.keys(MODE_READERS).sort());
});

it("every branch site compares the literal expression", () => {
  for (const file of Object.keys(MODE_READERS)) {
    if (file === "next.config.ts" || file === "lib/auth-mode.ts") continue;
    const reads = stripComments(readModule(file)).match(/process\.env\.NOVEDU_AUTH_MODE\b.{0,12}/g);
    expect(reads, file).not.toBeNull();
    for (const read of reads ?? [])
      expect(read, file).toMatch(/^process\.env\.NOVEDU_AUTH_MODE === "demo"/);
  }
});

it("demo-only modules are never imported statically", () => {
  const offenders: string[] = [];
  for (const file of appFiles()) {
    const source = stripComments(readModule(file));
    for (const match of source.matchAll(
      /^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm,
    )) {
      const specifier = (match[1] ?? "")
        .replace(/^@\//, "")
        .replace(/^\.\//, `${file.replace(/[^/]+$/, "")}`);
      if (DEMO_MODULES.some((demo) => specifier === demo || specifier.endsWith(`/${demo}`))) {
        offenders.push(`${file} → ${match[1]}`);
      }
    }
  }
  // Positive control: the scan sees the demo modules' own imports of each other…
  expect(offenders).toContain("lib/demo-seed.ts → @/lib/demo-personas");
  // …which are fine: a demo module only ever loads through a demo branch.
  expect(
    offenders.filter((entry) => !DEMO_MODULES.some((demo) => entry.startsWith(`${demo}.`))),
  ).toEqual([]);
});

it("each demo module is reached through a dynamic import", () => {
  const sources = appFiles().map((file) => stripComments(readModule(file)));
  for (const demo of [
    "lib/demo-boot",
    "lib/demo-seed",
    "lib/auth-demo-allowlist",
    "components/demo-ribbon",
  ]) {
    expect(
      sources.some((source) => source.includes(`await import("@/${demo}")`)),
      demo,
    ).toBe(true);
  }
  expect(sources.some((source) => source.includes(`await import("./demo-sign-in")`))).toBe(true);
});
