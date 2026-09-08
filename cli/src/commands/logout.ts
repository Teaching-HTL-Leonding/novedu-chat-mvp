import type { Command } from "commander";
import { printJson } from "../api";
import { forgetSession, revokeSession, storedSession } from "../auth";
import { resolveServerUrl } from "../server-url";

// Sign-out revokes the session server-side (best effort) and always removes the
// local token, so it succeeds even when the server is unreachable or nothing
// was stored (docs/api.md).
export function registerLogout(program: Command): void {
  program
    .command("logout")
    .description("Sign out: revoke this machine's session and remove the stored token")
    .option(
      "--server <url>",
      "Novedu server base URL (defaults to the NOVEDU_SERVER env var, then production)",
    )
    .addHelpText(
      "after",
      `
Sessions are per server: this signs out of one server only. The stored token is
removed even when the server cannot be reached (the session then expires on its
own). Running it while signed out is fine.`,
    )
    .action(async (options: { server?: string }) => {
      const server = resolveServerUrl(options.server);
      // Deliberately the STORED token, never NOVEDU_TOKEN: `logout` must not
      // revoke a session someone injected through the environment.
      const session = storedSession(server);
      if (session) await revokeSession(server, session.token);
      forgetSession(server);
      printJson({ status: "signed-out", server });
    });
}
