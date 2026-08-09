import { readFileSync } from "node:fs";

// The CLI's own version, read from package.json so `--version` and every report that
// stamps it always match the published package (no hand-kept duplicate to drift).
//
// The path is `../package.json` from THIS module in every context that matters:
// `cli/src/version.ts` (dev via tsx / vitest) and the bundled `cli/dist/main.js`
// (tsdown emits a single file) both sit one level under the package root.

let cached: string | undefined;

/** The `version` field of the CLI's package.json; `"unknown"` if it cannot be read. */
export function cliVersion(): string {
  if (cached !== undefined) return cached;
  try {
    const { version } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    cached = version ?? "unknown";
  } catch {
    cached = "unknown";
  }
  return cached;
}
