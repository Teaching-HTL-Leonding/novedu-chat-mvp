// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";

// RSC boundary invariant: a module WITHOUT "use client" may be evaluated in the
// server graph, where every export of a "use client" module is an opaque
// client-reference proxy — fine for COMPONENTS (rendered by reference), but a
// plain value (a class-string constant, a hook, a helper) arrives as the proxy,
// not the value; coercing it renders the proxy's source into the page. This
// test flags any non-client module importing a non-component (non-PascalCase,
// non-type) name from a client module. Share such values from a directive-free
// module instead (e.g. app/[code]/_coding/code-panel.ts).

const SCAN_ROOTS = ["app", "components", "lib"];

function listSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSources(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name))
      found.push(path);
  }
  return found;
}

const isClientModule = (source: string) => /^\s*["']use client["']/.test(source);

/** Resolve an import specifier to a repo file path, or undefined for packages. */
function resolveImport(fromFile: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) base = resolve(specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return undefined;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next extension
    }
  }
  return undefined;
}

// PascalCase (mixed case, initial capital) = a component; everything else that
// isn't type-only (camelCase values/hooks, SCREAMING_CASE constants) is flagged.
const isComponentName = (name: string) =>
  /^[A-Z]/.test(name) && name !== name.toUpperCase() && !name.includes("_");

const IMPORT_RE =
  /import\s+(type\s+)?(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|[\w$]+|\*\s+as\s+[\w$]+)?\s*from\s*["']([^"']+)["']/g;

it("no server-capable module imports a non-component value from a 'use client' module", () => {
  const files = SCAN_ROOTS.flatMap(listSources);
  const clientModules = new Set(files.filter((file) => isClientModule(readFileSync(file, "utf8"))));

  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (isClientModule(source)) continue; // client importer — no boundary crossed

    for (const match of source.matchAll(IMPORT_RE)) {
      const [, typeOnly, , namedList, specifier] = match;
      if (typeOnly || !namedList || !specifier) continue; // `import type` / default / namespace
      const target = resolveImport(file, specifier);
      if (!target || !clientModules.has(target)) continue;

      for (const rawName of namedList.split(",")) {
        const name = rawName
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (!name || rawName.trim().startsWith("type ")) continue;
        if (!isComponentName(name)) {
          violations.push(`${file}: imports "${name}" from client module ${target}`);
        }
      }
    }
  }

  expect(violations).toEqual([]);
});
