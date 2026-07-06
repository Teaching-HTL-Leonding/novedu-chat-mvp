import type { Command } from "commander";
import {
  acquireByDeviceCode,
  acquireInteractive,
  acquireSilent,
  buildPca,
  displayName,
} from "../auth";

export function registerLogin(program: Command): void {
  program
    .command("login")
    .description("Sign in to Microsoft Entra ID (opens your browser)")
    .option(
      "--device-code",
      "sign in with the device code flow instead (for machines without a browser; the tenant must allow it)",
    )
    .addHelpText(
      "after",
      `
Sign-in is the one human-assisted step: by default a browser window opens for
the Microsoft sign-in (first-time users see a one-time consent prompt). On a
machine without a browser, --device-code prints a verification URL and a code
to enter from any other device — note that some tenants block the device code
flow by policy (error 53003). Every other command then works non-interactively
from the cached credentials. Already signed in? The command says so and exits
— it never blocks.`,
    )
    .action(async (options: { deviceCode?: boolean }) => {
      const pca = buildPca();

      // Silent first: an agent re-running `login` must never hang waiting for
      // an interactive sign-in when the cached refresh token still works.
      const cached = await acquireSilent(pca);
      if (cached) {
        console.log(`Already signed in as ${displayName(cached)}.`);
        return;
      }

      const result = options.deviceCode
        ? await acquireByDeviceCode(pca, (message) => console.log(message))
        : await acquireInteractive(pca, (url) => {
            console.log("A browser window should open for the Microsoft sign-in.");
            console.log(`If it does not, open this URL yourself:\n${url}`);
          });
      console.log(`Signed in as ${displayName(result)}.`);
    });
}
