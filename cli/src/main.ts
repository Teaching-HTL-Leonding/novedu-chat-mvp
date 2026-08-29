#!/usr/bin/env node
import { Command } from "commander";
import { registerCodes } from "./commands/codes";
import { registerEval } from "./commands/eval";
import { registerFiles } from "./commands/files";
import { registerImages } from "./commands/images";
import { registerLogin } from "./commands/login";
import { registerLogout } from "./commands/logout";
import { registerPrompts } from "./commands/prompts";
import { registerReports } from "./commands/reports";
import { registerValidate } from "./commands/validate";
import { registerWhoami } from "./commands/whoami";
import { resolveServerUrl } from "./server-url";
import { cliVersion } from "./version";

// Entry point for the `novedu-cli` CLI. Each feature registers itself as a
// subcommand: offline validation (`validate`) and prompt inspection (`prompts`),
// grader evaluation (`eval`), auth (`login`/`logout`/`whoami`), and the JSON
// management commands (`codes`, `files`).
const program = new Command();

program
  .name("novedu-cli")
  .description("Command-line companion for the Novedu chat app")
  // Derived from the resolved server so a --server/NOVEDU_SERVER override (or a
  // domain change via DEFAULT_SERVER) keeps the pointer correct automatically.
  .addHelpText(
    "after",
    `\nDocs: the Novedu teacher guide lives at ${resolveServerUrl()}/docs — ` +
      `machine-readable at ${resolveServerUrl()}/docs/llms.txt (index) and ` +
      `${resolveServerUrl()}/docs/llms-full.txt (full corpus).`,
  )
  .version(cliVersion());

registerValidate(program);
registerPrompts(program);
registerEval(program);
registerLogin(program);
registerLogout(program);
registerWhoami(program);
registerCodes(program);
registerFiles(program);
registerImages(program);
registerReports(program);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
