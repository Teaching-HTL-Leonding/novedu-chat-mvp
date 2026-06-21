import { getActiveFile } from "@/lib/file-store";
import { filesUrlPrefix } from "@/lib/file-url";
import { defaultFetcher, type Fetcher } from "@/lib/tutors";

// The ONE definition of how an app-hosted file URL (`<origin>/api/files/<name>`)
// resolves: from the DATABASE (via getActiveFile) instead of a network round-trip
// back to our own public origin — which a container may not be able to reach, and
// which is fragile around an exact self-URL string match. Everything else (e.g. a
// file hosted on GitHub) is fetched for real with defaultFetcher.
//
// Shared by the save-time buffer validator, the student GUI's referenced-fragment
// loader (both in lib/files-actions.ts), and the quiz loader (lib/quiz-fetch.ts),
// so this resolution lives in EXACTLY ONE place — see docs/files.md. A plain
// module (NOT "use server") on purpose: a `"use server"` file may only export
// async actions, so the resolver could not be shared from there.
//
// SERVER-ONLY: touches the database and fetches arbitrary URLs. Never import from
// client components.
export function appHostedFetcher(origin: string): Fetcher {
  const prefix = filesUrlPrefix(origin);
  return async (url) => {
    if (url.startsWith(prefix)) {
      const refName = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0] ?? "");
      const file = await getActiveFile(refName);
      if (file) return { ok: true, status: 200, text: async () => file.content };
      return { ok: false, status: 404, text: async () => "" };
    }
    return defaultFetcher(url);
  };
}
