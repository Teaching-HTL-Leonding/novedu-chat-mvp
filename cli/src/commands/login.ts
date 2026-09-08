import type { Command } from "commander";
import { failJson, printJson } from "../api";
import {
  type DeviceCode,
  fetchIdentity,
  getAccessToken,
  openBrowser,
  pollDeviceToken,
  rememberSession,
  requestDeviceCode,
} from "../auth";
import { resolveServerUrl } from "../server-url";

// Sign-in runs the Novedu server's own device authorization flow: the CLI asks
// for a code, the human approves it in a browser signed in to the app, and the
// CLI polls until the server hands over a session token (docs/api.md).
//
// Output contract: stdout stays JSON-only, so the human instructions (the URL
// and the code) go to STDERR — an agent piping stdout into jq still gets a
// clean object, and a human still sees what to open.
export function registerLogin(program: Command): void {
  program
    .command("login")
    .description("Sign in to Novedu by approving a device code in your browser")
    .option(
      "--server <url>",
      "Novedu server base URL (defaults to the NOVEDU_SERVER env var, then production)",
    )
    .addHelpText(
      "after",
      `
Sign-in is the one human-assisted step: the command prints a verification link
and an eight-character code (on stderr) and tries to open the link in your
browser. Approve the code there while signed in to Novedu, and the CLI stores
the resulting session token in ~/.novedu/sessions.json (per server). Every
other command then works non-interactively. Already signed in? The command
says so and exits — it never blocks.`,
    )
    .action(async (options: { server?: string }) => {
      const server = resolveServerUrl(options.server);

      // Silent first: an agent re-running `login` must never wait for a human
      // when the stored session still works.
      let existing: string | null;
      try {
        existing = await currentIdentity(server);
      } catch (error) {
        // The server is down, not the session: starting a second device flow
        // here would burn a human approval on a session that may already exist.
        failJson({ message: messageOf(error) });
        return;
      }
      if (existing) {
        printJson({ status: "already-signed-in", name: existing, server });
        return;
      }

      let code: DeviceCode;
      try {
        code = await requestDeviceCode(server);
      } catch (error) {
        failJson({ message: messageOf(error) });
        return;
      }

      console.error(`Open ${code.verification_uri_complete}`);
      console.error(`Code: ${code.user_code}`);
      openBrowser(code.verification_uri_complete);

      let token: string;
      try {
        token = await pollDeviceToken(server, code);
      } catch (error) {
        failJson({ message: messageOf(error) });
        return;
      }

      // Store the token BEFORE probing for the name: the session already exists
      // server-side, and dropping it over a hiccup in the probe would leave an
      // orphaned 30-day row and force another human approval. The name is a
      // convenience — it is filled in once the probe answers.
      rememberSession(server, { token, name: "" });

      let name: string | null = null;
      try {
        const identity = await fetchIdentity(server, token);
        name = identity ? (identity.name ?? identity.userId) : null;
      } catch (error) {
        console.error(messageOf(error));
      }
      if (name) rememberSession(server, { token, name });
      else console.error("Signed in; the display name could not be read.");
      printJson({ status: "signed-in", name, server });
    });
}

/**
 * The stored session's display name when it still authenticates, `null` when
 * nothing is stored or the server rejected the token (the device flow has to
 * run). An unreachable server THROWS — see `fetchIdentity`.
 */
async function currentIdentity(server: string): Promise<string | null> {
  let token: string;
  try {
    token = await getAccessToken(server);
  } catch {
    return null;
  }
  const identity = await fetchIdentity(server, token);
  return identity ? (identity.name ?? identity.userId) : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
