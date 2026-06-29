import { loadAppHostedYaml } from "@/lib/app-hosted-yaml";
import { parseWriting, type Writing } from "@/lib/writing-yaml";

// Loads + leniently parses the writing YAML behind a (verified) writing URL, via the
// shared `loadAppHostedYaml`. The single definition shared by the render component, the
// `saveWriting` action, and the runtime route's writing branch, so they all read the
// same activity the same way. SERVER-ONLY: touches the database and fetches arbitrary URLs.

export type LoadWritingResult = { ok: true; writing: Writing } | { ok: false; message: string };

export function loadWriting(url: string): Promise<LoadWritingResult> {
  return loadAppHostedYaml(url, parseWriting, "writing activity");
}
