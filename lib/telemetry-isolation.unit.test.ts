// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { importSpecifiers, REPO_ROOT, walkClosure } from "../tests/import-graph";

// The CLI never initializes telemetry and must not create an exporter — even
// with OTEL_* or Azure variables in its environment (docs/telemetry.md). This
// grep-guard walks the ENTIRE transitive import closure of `cli/src/**` (with
// the shared walker in tests/import-graph.ts) and fails if any module in it
// imports the telemetry facade/initializers or an OpenTelemetry SDK,
// instrumentation, or the Azure distro. Package names are checked on the raw
// specifier (bare specifiers do not resolve to a repo path); repo modules on
// the resolved path, so "@/lib/telemetry", "../lib/telemetry" and
// "./telemetry" are the same offender.

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

describe("CLI telemetry isolation", () => {
  it("cli/src's transitive import closure contains no telemetry facade and no OTel SDK", () => {
    const roots = [...walk(join(REPO_ROOT, "cli", "src"))].map((f) =>
      relative(REPO_ROOT, f).replace(/\\/g, "/"),
    );
    expect(roots.length).toBeGreaterThanOrEqual(20);

    const offenders: string[] = [];
    // Every repo path the closure reaches keeps the walk going (the walker drops the
    // ones that are not source files), so nothing the CLI bundles escapes the check.
    const visited = walkClosure(roots, ({ rel, imports }) => {
      const next: string[] = [];
      for (const { specifier, rel: target } of imports) {
        if (FORBIDDEN_PACKAGES.some((p) => p.test(specifier))) {
          offenders.push(`${rel} → ${specifier}`);
          continue;
        }
        if (target === null) continue;
        if (FORBIDDEN_MODULES.some((p) => p.test(target))) offenders.push(`${rel} → ${target}`);
        else next.push(target);
      }
      return next;
    });
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
