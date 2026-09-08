import type { Command } from "commander";
import { failJson, printJson } from "../api";
import { fetchIdentity, getAccessToken } from "../auth";
import { resolveServerUrl } from "../server-url";

// The end-to-end auth probe: reads the stored session token for this server
// (`~/.novedu/sessions.json`, or `NOVEDU_TOKEN` when set) and sends it as a
// bearer to the app's bearer-protected GET /api/me (docs/api.md). Succeeding
// here proves the whole chain — token lookup, server validation.
export function registerWhoami(program: Command): void {
  program
    .command("whoami")
    .description("Show who is signed in by calling the Novedu server's /api/me")
    .option(
      "--server <url>",
      "Novedu server base URL (defaults to the NOVEDU_SERVER env var, then production)",
    )
    .action(async (options: { server?: string }) => {
      // The server first: sessions are stored per server, so the token lookup
      // needs to know which one is being probed.
      const server = resolveServerUrl(options.server);
      try {
        const token = await getAccessToken(server);
        const identity = await fetchIdentity(server, token);
        if (!identity) {
          failJson({ message: `${server} rejected the stored token — run "novedu-cli login".` });
          return;
        }
        printJson({ ...identity, server });
      } catch (error) {
        failJson({ message: error instanceof Error ? error.message : String(error) });
      }
    });
}
