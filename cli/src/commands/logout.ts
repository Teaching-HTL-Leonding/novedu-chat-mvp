import { rmSync } from "node:fs";
import type { Command } from "commander";
import { buildPca, TOKEN_CACHE_PATH } from "../auth";

export function registerLogout(program: Command): void {
  program
    .command("logout")
    .description("Sign out: remove the cached credentials from this machine")
    .addHelpText(
      "after",
      `
Purely local — already-issued access tokens stay valid until they expire
(about an hour). Running it while signed out is fine.`,
    )
    .action(async () => {
      const cache = buildPca().getTokenCache();
      // removeAccount drops the account's tokens (incl. the refresh token)
      // from the serialized cache; deleting the file afterwards clears any
      // remaining metadata.
      for (const account of await cache.getAllAccounts()) {
        await cache.removeAccount(account);
      }
      rmSync(TOKEN_CACHE_PATH, { force: true });
      console.log("Signed out.");
    });
}
