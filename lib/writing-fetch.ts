import { appHostedFetcher } from "@/lib/app-hosted-fetcher";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { parseWriting, type Writing } from "@/lib/writing-yaml";

// Loads + leniently parses the writing YAML behind a (verified) writing URL — the
// writing analog of `lib/quiz-fetch`. The single definition shared by the render
// component, the `saveWriting` action, and the runtime route's writing branch, so
// they all read the same activity the same way.
//
// App-hosted activities (`<origin>/api/files/<name>`) are read straight from the
// database rather than fetched over the network, via the SHARED `appHostedFetcher`
// — the one definition of that loopback-avoiding resolution (a container may not
// be able to reach its own public origin). Anything else (e.g. a file hosted on
// GitHub) is fetched for real, uncached, so edits show immediately. Origin is
// resolved leniently (`resolveAppOriginOr("")`): on the read/serve path we degrade
// to a network fetch rather than hard-failing the way the authoring validator does.
//
// SERVER-ONLY: touches the database and fetches arbitrary URLs.

export type LoadWritingResult = { ok: true; writing: Writing } | { ok: false; message: string };

export async function loadWriting(url: string): Promise<LoadWritingResult> {
  let content: string;
  try {
    const origin = await resolveAppOriginOr("");
    const res = await appHostedFetcher(origin)(url);
    if (!res.ok) {
      return res.status === 404
        ? { ok: false, message: "This writing activity could not be found." }
        : { ok: false, message: `This writing activity could not be loaded (HTTP ${res.status}).` };
    }
    content = await res.text();
  } catch {
    return { ok: false, message: "This writing activity could not be loaded. Try again." };
  }
  return parseWriting(content);
}
