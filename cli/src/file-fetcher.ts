import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defaultFetcher, type Fetcher } from "@/lib/prompt-fragments";

// A composite `Fetcher` (the tutor core's single network seam): `file://` URLs are
// read from disk, everything else delegates to the app's production fetcher. This
// is all the CLI needs to point the *unchanged* validation pipeline at a local
// tutor YAML — the loader resolves relative `fragment_files` against the tutor's
// `file://` URL, so sibling fragment files are read from the same folder.
//
// A missing/unreadable file is reported as a 404 so it surfaces as the core's
// normal `FETCH_FAILED` error rather than throwing.
export const cliFetcher: Fetcher = async (url) => {
  if (url.startsWith("file:")) {
    try {
      const text = await readFile(fileURLToPath(url), "utf8");
      return { ok: true, status: 200, text: async () => text };
    } catch {
      return { ok: false, status: 404, text: async () => "" };
    }
  }
  return defaultFetcher(url);
};
