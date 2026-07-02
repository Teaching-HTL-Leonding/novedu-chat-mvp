// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Styling invariant (docs/styling.md): the app styles with Tailwind only — CSS
// Modules are not part of the styling system. A new *.module.css under app/ or
// components/ means a recipe bypassed the reuse boundary; express it as
// utilities in the owning component or as a components/ui primitive instead.

function findCssModules(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findCssModules(path));
    else if (entry.name.endsWith(".module.css")) found.push(path);
  }
  return found;
}

it("no CSS-module file exists under app/ or components/", () => {
  expect([...findCssModules("app"), ...findCssModules("components")]).toEqual([]);
});
