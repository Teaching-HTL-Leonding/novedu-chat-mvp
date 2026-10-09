import { expect, it } from "vitest";
import { readModule, resolveImport, sourceFiles } from "@/tests/import-graph";

// RSC boundary invariant: a module WITHOUT "use client" may be evaluated in the
// server graph, where every export of a "use client" module is an opaque
// client-reference proxy — fine for COMPONENTS (rendered by reference), but a
// plain value (a class-string constant, a hook, a helper) arrives as the proxy,
// not the value; coercing it renders the proxy's source into the page. This
// test flags any non-client module importing a non-component (non-PascalCase,
// non-type) name from a client module. Share such values from a directive-free
// module instead (e.g. app/[code]/_coding/code-panel.ts).

const files = sourceFiles("app", "components", "lib");

const isClientModule = (source: string) => /^\s*["']use client["']/.test(source);
const isServerActionModule = (source: string) => /^\s*["']use server["']/m.test(source);

// PascalCase (mixed case, initial capital) = a component; everything else that
// isn't type-only (camelCase values/hooks, SCREAMING_CASE constants) is flagged.
const isComponentName = (name: string) =>
  /^[A-Z]/.test(name) && name !== name.toUpperCase() && !name.includes("_");

const IMPORT_RE =
  /import\s+(type\s+)?(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|[\w$]+|\*\s+as\s+[\w$]+)?\s*from\s*["']([^"']+)["']/g;

it("no server-capable module imports a non-component value from a 'use client' module", () => {
  const clientModules = new Set(files.filter((file) => isClientModule(readModule(file))));

  let crossings = 0;
  const violations: string[] = [];
  for (const file of files) {
    const source = readModule(file);
    if (isClientModule(source)) continue; // client importer — no boundary crossed

    for (const match of source.matchAll(IMPORT_RE)) {
      const [, typeOnly, , namedList, specifier] = match;
      if (typeOnly || !namedList || !specifier) continue; // `import type` / default / namespace
      const target = resolveImport(file, specifier).rel;
      if (!target || !clientModules.has(target)) continue;
      crossings++;

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

  // Not vacuous: server-capable modules do import components across the boundary.
  expect(crossings).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});

// Every export of a "use server" module is a public endpoint, so such a module
// only declares its own actions: a re-export would publish someone else's
// function (re-exporting lib/quiz-verify.ts's loader would hand out the quiz's
// evaluation prompts), and even `export type { … }` crashes the module at load.
// A wrapper function is beyond any grep — this only stops the re-export forms.
it("no 'use server' module re-exports anything", () => {
  const serverActionModules = files.filter((file) => isServerActionModule(readModule(file)));
  expect(serverActionModules).toContain("lib/tutor-actions.ts"); // not vacuous
  const offenders = serverActionModules.filter((file) =>
    /^export\s+(\*|(type\s+)?\{)/m.test(readModule(file)),
  );
  expect(offenders).toEqual([]);
});
