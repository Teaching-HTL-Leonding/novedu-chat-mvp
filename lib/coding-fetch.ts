import { appHostedFetcher } from "@/lib/app-hosted-fetcher";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { type Coding, parseCoding } from "@/lib/coding-yaml";

// Loads + leniently parses the coding YAML behind a (verified) code's file_url —
// the coding analog of `lib/writing-fetch`. The single definition shared by the
// OpenAI-compatible proxy route and the student/teacher render surfaces, so they
// all read the same activity the same way.
//
// App-hosted activities (`<origin>/api/files/<name>`) are read straight from the
// database via the SHARED `appHostedFetcher` (a container may not reach its own
// public origin); anything else is fetched for real, uncached, so edits show
// immediately. Origin is resolved leniently (`resolveAppOriginOr("")`): on the
// read/serve path we degrade to a network fetch rather than hard-failing.
//
// SERVER-ONLY: touches the database and fetches arbitrary URLs.

export type LoadCodingResult = { ok: true; coding: Coding } | { ok: false; message: string };

export async function loadCoding(url: string): Promise<LoadCodingResult> {
  let content: string;
  try {
    const origin = await resolveAppOriginOr("");
    const res = await appHostedFetcher(origin)(url);
    if (!res.ok) {
      return res.status === 404
        ? { ok: false, message: "This coding activity could not be found." }
        : { ok: false, message: `This coding activity could not be loaded (HTTP ${res.status}).` };
    }
    content = await res.text();
  } catch {
    return { ok: false, message: "This coding activity could not be loaded. Try again." };
  }
  return parseCoding(content);
}
