import { appHostedFetcher } from "@/lib/app-hosted-fetcher";
import { resolveAppOriginOr } from "@/lib/app-origin";

// Loads + leniently parses the YAML behind a (verified) activity URL — the single
// definition every module's loader (coding / writing / quiz) shares, so they all read
// an activity the same way.
//
// App-hosted activities (`<origin>/api/files/<name>`) are read straight from the
// database via the SHARED `appHostedFetcher` — the one definition of that
// loopback-avoiding resolution (a container may not be able to reach its own public
// origin). Anything else (e.g. a file hosted on GitHub) is fetched for real, uncached,
// so edits show immediately. Origin is resolved leniently (`resolveAppOriginOr("")`):
// on the read/serve path we degrade to a network fetch rather than hard-failing the way
// the authoring validator does. The friendly `noun` ("quiz", "coding activity", …)
// personalizes the not-found / could-not-load messages.
//
// SERVER-ONLY: touches the database and fetches arbitrary URLs.

export async function loadAppHostedYaml<R extends { ok: boolean }>(
  url: string,
  parse: (content: string) => R,
  noun: string,
): Promise<R | { ok: false; message: string }> {
  try {
    const origin = await resolveAppOriginOr("");
    const res = await appHostedFetcher(origin)(url);
    if (!res.ok) {
      return res.status === 404
        ? { ok: false, message: `This ${noun} could not be found.` }
        : { ok: false, message: `This ${noun} could not be loaded (HTTP ${res.status}).` };
    }
    return parse(await res.text());
  } catch {
    return { ok: false, message: `This ${noun} could not be loaded. Try again.` };
  }
}
