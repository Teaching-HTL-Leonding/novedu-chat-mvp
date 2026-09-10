// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The CLI never initializes telemetry and must not create an exporter — even
// with OTEL_* or Azure variables in its environment (docs/telemetry.md). This
// grep-guard walks the ENTIRE transitive import closure of `cli/src/**` (the
// same walker shape as lib/prompt-dump.unit.test.ts) and fails if any module in
// it imports the telemetry facade/initializers or an OpenTelemetry SDK,
// instrumentation, or the Azure distro. Package names are checked on the raw
// specifier (bare specifiers do not resolve to a repo path); repo modules on
// the resolved path, so "@/lib/telemetry", "../lib/telemetry" and
// "./telemetry" are the same offender.

const REPO_ROOT = join(__dirname, "..");
const IGNORE = new Set(["node_modules", "dist", ".next"]);

const FORBIDDEN_PACKAGES = [
  /^@opentelemetry\/sdk-/,
  /^@opentelemetry\/instrumentation/,
  /^@opentelemetry\/exporter-/,
  /^@azure\/monitor-opentelemetry/,
];
const FORBIDDEN_MODULES = [/^lib\/telemetry(-[a-z]+)?\.ts$/];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) yield full;
  }
}

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** Every static/dynamic/side-effect/re-export specifier in a module's source. */
const importSpecifiers = (src: string): string[] =>
  [
    ...src.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...src.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g),
  ].map((m) => m[1] ?? "");

const resolveImport = (spec: string, importerRel: string): string | null => {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = join(dirname(importerRel), spec);
  else return null;
  base = normalize(base).replace(/\\/g, "/");
  for (const rel of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    const abs = join(REPO_ROOT, rel);
    if (existsSync(abs) && statSync(abs).isFile()) return rel;
  }
  return base;
};

describe("CLI telemetry isolation", () => {
  it("cli/src's transitive import closure contains no telemetry facade and no OTel SDK", () => {
    const roots = [...walk(join(REPO_ROOT, "cli", "src"))].map((f) =>
      relative(REPO_ROOT, f).replace(/\\/g, "/"),
    );
    expect(roots.length).toBeGreaterThanOrEqual(20);

    const visited = new Set<string>();
    const offenders: string[] = [];
    const queue = [...roots];
    while (queue.length > 0) {
      const rel = queue.pop() as string;
      if (visited.has(rel) || !existsSync(join(REPO_ROOT, rel))) continue;
      visited.add(rel);
      for (const spec of importSpecifiers(read(rel))) {
        if (FORBIDDEN_PACKAGES.some((p) => p.test(spec))) {
          offenders.push(`${rel} → ${spec}`);
          continue;
        }
        const target = resolveImport(spec, rel);
        if (!target) continue;
        if (FORBIDDEN_MODULES.some((p) => p.test(target))) offenders.push(`${rel} → ${target}`);
        else queue.push(target);
      }
    }
    // Sanity: the walk actually crossed into the shared lib/ code the CLI bundles.
    expect([...visited].some((rel) => rel.startsWith("lib/"))).toBe(true);
    expect(offenders, `telemetry reachable from the CLI: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the facade is in use by the server code (so a broken regex cannot pass vacuously)", () => {
    const importers: string[] = [];
    for (const dir of ["app", "lib"]) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        if (importSpecifiers(readFileSync(file, "utf8")).includes("@/lib/telemetry")) {
          importers.push(relative(REPO_ROOT, file));
        }
      }
    }
    expect(importers.length).toBeGreaterThanOrEqual(5);
    expect(FORBIDDEN_MODULES.some((p) => p.test("lib/telemetry.ts"))).toBe(true);
    expect(FORBIDDEN_MODULES.some((p) => p.test("lib/telemetry-otlp.ts"))).toBe(true);
    expect(FORBIDDEN_PACKAGES.some((p) => p.test("@opentelemetry/sdk-node"))).toBe(true);
  });
});
