import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import { type BuildResult, loadAndBuildTutorPrompt } from "@/lib/tutors";
import { cliFetcher } from "../file-fetcher";
import { formatResult } from "../format";

/**
 * Turn the CLI argument into a URL the tutor core understands: an http(s) URL is
 * used as-is; anything else is treated as a filesystem path and converted to an
 * absolute `file://` URL.
 */
export function toUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return pathToFileURL(resolve(pathOrUrl)).href;
}

/**
 * The validate command's pure core: run the existing tutor pipeline over a local
 * file or public URL. Kept separate from the commander wiring so it can be unit
 * tested in-process. `file:` is allowed in addition to http(s) so local YAML can
 * be validated (the web app deliberately stays http(s)-only).
 */
export function runValidate(pathOrUrl: string): Promise<BuildResult> {
  return loadAndBuildTutorPrompt(toUrl(pathOrUrl), cliFetcher, {
    allowedSchemes: ["http:", "https:", "file:"],
  });
}

export function registerValidate(program: Command): void {
  program
    .command("validate")
    .description("Validate a tutor YAML by local path or public http(s) URL")
    .argument("<pathOrUrl>", "path to a tutor YAML file, or a public http(s) URL")
    .option("--json", "print the raw validation result as JSON")
    .action(async (pathOrUrl: string, options: { json?: boolean }) => {
      const result = await runValidate(pathOrUrl);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatResult(result, pathOrUrl));
      }
      // Non-zero exit on failure so the CLI is usable as a CI/pre-commit gate.
      process.exitCode = result.ok ? 0 : 1;
    });
}
