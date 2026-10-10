import { describe, expect, it } from "vitest";
import {
  importSpecifiers,
  readModule,
  resolveImport,
  sourceFiles,
  walkClosure,
} from "../tests/import-graph";

// The CLI never initializes telemetry and must not create an exporter — even
// with OTEL_* or Azure variables in its environment (docs/telemetry.md). This
// grep-guard walks the ENTIRE transitive import closure of `cli/src/**` (with
// the shared walker in tests/import-graph.ts) and fails if any module in it
// imports the telemetry facade/initializers or an OpenTelemetry SDK,
// instrumentation, or the Azure distro. Package names are checked on the raw
// specifier (bare specifiers do not resolve to a repo path); repo modules on
// the resolved path, so "@/lib/telemetry", "../lib/telemetry" and
// "./telemetry" are the same offender.

const FORBIDDEN_PACKAGES = [
  /^@opentelemetry\/sdk-/,
  /^@opentelemetry\/instrumentation/,
  /^@opentelemetry\/exporter-/,
  /^@azure\/monitor-opentelemetry/,
];
const FORBIDDEN_MODULES = [/^lib\/telemetry(-[a-z]+)?\.ts$/];

describe("CLI telemetry isolation", () => {
  it("cli/src's transitive import closure contains no telemetry facade and no OTel SDK", () => {
    const roots = sourceFiles("cli/src");
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
    // Server modules whose RESOLVED imports the forbidden-module patterns match.
    const importers = sourceFiles("app", "lib").filter((rel) =>
      importSpecifiers(readModule(rel)).some((spec) => {
        const target = resolveImport(rel, spec).rel;
        return target !== null && FORBIDDEN_MODULES.some((p) => p.test(target));
      }),
    );
    expect(importers.length).toBeGreaterThanOrEqual(5);
    expect(FORBIDDEN_PACKAGES.some((p) => p.test("@opentelemetry/sdk-node"))).toBe(true);
  });
});
