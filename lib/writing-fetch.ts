import { loadAppHostedYaml } from "@/lib/app-hosted-yaml";
import { assembleFragmentPrompt, EMPTY_FRAGMENT_BLOCK } from "@/lib/prompt-fragments";
import { parseWriting, type Writing } from "@/lib/writing-yaml";

// Loads + leniently parses the writing YAML behind a (verified) writing URL, via the
// shared `loadAppHostedYaml`, and renders the teacher's `instructions` host text (with
// any inline `{{fragment}}` markers resolved in place) into the final `instructions`.
// The single definition shared by the render component, the `saveWriting` action, and
// the runtime route's writing branch, so they all read the same activity the same way.
// SERVER-ONLY: touches the database and fetches arbitrary URLs.

export type LoadWritingResult = { ok: true; writing: Writing } | { ok: false; message: string };

export function loadWriting(url: string): Promise<LoadWritingResult> {
  return loadAppHostedYaml(
    url,
    parseWriting,
    "writing activity",
    async (parsed, { url, fetcher }) => {
      const resolved = await assembleFragmentPrompt(
        parsed.writing.fragmentBlock,
        url,
        fetcher,
        { validateLibraries: false },
        parsed.writing.instructions,
      );
      if (!resolved.ok) {
        // Fail closed — same hard-error path as an unfetchable activity YAML.
        return {
          ok: false,
          message: "This writing activity's prompt fragments could not be loaded.",
        };
      }
      return {
        ok: true,
        writing: {
          ...parsed.writing,
          fragmentBlock: EMPTY_FRAGMENT_BLOCK,
          instructions: resolved.prompt,
        },
      };
    },
  );
}
