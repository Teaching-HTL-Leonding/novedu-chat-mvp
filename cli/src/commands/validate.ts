import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import {
  type BuildResult,
  type FragmentCheckResult,
  loadAndBuildTutorPrompt,
  loadAndCheckFragmentFile,
} from "@/lib/tutors";
import { cliFetcher } from "../file-fetcher";
import { formatFragmentResult, formatResult } from "../format";

/** What the input YAML is validated AS — declared by the caller, never auto-detected. */
export type ValidateKind = "tutor" | "fragment";

/** The CLI-local outcome: the raw core result tagged with the kind that produced it, so the command can pick a formatter without re-deriving it. */
export type ValidateOutcome =
  | { kind: "tutor"; result: BuildResult }
  | { kind: "fragment"; result: FragmentCheckResult };

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
 * The validate command's pure core: run the requested pipeline over a local file or
 * public URL. `file:` is allowed in addition to http(s) so local YAML can be
 * validated (the web app deliberately stays http(s)-only). As an authoring tool, the
 * tutor path runs the THOROUGH check (`validateLibraries`), so every fragment in every
 * referenced library is rendered — not just the ones the tutor uses.
 */
export function runValidate(pathOrUrl: string, kind: ValidateKind): Promise<ValidateOutcome> {
  const url = toUrl(pathOrUrl);
  const allowedSchemes = ["http:", "https:", "file:"];
  if (kind === "fragment") {
    return loadAndCheckFragmentFile(url, cliFetcher, { allowedSchemes }).then((result) => ({
      kind,
      result,
    }));
  }
  return loadAndBuildTutorPrompt(url, cliFetcher, {
    allowedSchemes,
    validateLibraries: true,
  }).then((result) => ({ kind, result }));
}

export function registerValidate(program: Command): void {
  program
    .command("validate")
    .description(
      "Validate a tutor YAML (default) or a fragment library by local path or public http(s) URL",
    )
    .argument("<pathOrUrl>", "path to a tutor or fragment YAML file, or a public http(s) URL")
    .option("--kind <kind>", "what the file is: 'tutor' (default) or 'fragment'", "tutor")
    .option("--json", "print the raw validation result as JSON")
    .action(async (pathOrUrl: string, options: { kind?: string; json?: boolean }) => {
      if (options.kind !== undefined && options.kind !== "tutor" && options.kind !== "fragment") {
        console.error(`Invalid --kind "${options.kind}": expected "tutor" or "fragment".`);
        process.exitCode = 1;
        return;
      }
      const kind: ValidateKind = options.kind === "fragment" ? "fragment" : "tutor";
      const outcome = await runValidate(pathOrUrl, kind);
      if (options.json) {
        console.log(JSON.stringify(outcome.result, null, 2));
      } else {
        console.log(
          outcome.kind === "fragment"
            ? formatFragmentResult(outcome.result, pathOrUrl)
            : formatResult(outcome.result, pathOrUrl),
        );
      }
      // Non-zero exit on failure so the CLI is usable as a CI/pre-commit gate.
      process.exitCode = outcome.result.ok ? 0 : 1;
    });
}
