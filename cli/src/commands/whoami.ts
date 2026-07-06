import type { Command } from "commander";
import { getAccessToken, NotSignedInError } from "../auth";
import { resolveServerUrl } from "../server-url";

// The end-to-end auth probe: silently acquires a token and calls the app's
// bearer-protected GET /api/me (docs/api.md). Succeeding here proves the whole
// chain — cache, refresh, token audience/scope, server validation.
export function registerWhoami(program: Command): void {
  program
    .command("whoami")
    .description("Show who is signed in by calling the Novedu server's /api/me")
    .option(
      "--server <url>",
      "Novedu server base URL (defaults to the NOVEDU_SERVER env var, then production)",
    )
    .action(async (options: { server?: string }) => {
      let token: string;
      try {
        token = await getAccessToken();
      } catch (error) {
        if (error instanceof NotSignedInError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      const server = resolveServerUrl(options.server);
      let response: Response;
      try {
        response = await fetch(new URL("/api/me", server), {
          headers: { authorization: `Bearer ${token}` },
        });
      } catch (error) {
        console.error(
          `Could not reach ${server}: ${error instanceof Error ? error.message : error}`,
        );
        process.exitCode = 1;
        return;
      }
      if (!response.ok) {
        console.error(`${server} rejected the request: HTTP ${response.status}`);
        process.exitCode = 1;
        return;
      }

      const me = (await response.json()) as {
        name: string | null;
        userId: string;
        isTeacher: boolean;
      };
      console.log(`Signed in as ${me.name ?? "(no name)"}`);
      console.log(`User id: ${me.userId}`);
      console.log(`Teacher: ${me.isTeacher ? "yes" : "no"}`);
    });
}
