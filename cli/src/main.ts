#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { registerValidate } from "./commands/validate";

// Read the version from package.json so `--version` always matches the published
// package (no hand-kept duplicate to drift). Both src/main.ts (dev via tsx) and
// dist/main.js (built/published) sit one level under the package root, so
// `../package.json` resolves the same in every context.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

// Entry point for the `novedu-cli` CLI. Each feature registers itself as a
// subcommand; today that's `validate`, with more to follow.
const program = new Command();

program
  .name("novedu-cli")
  .description("Command-line companion for the Novedu chat app")
  .version(version);

registerValidate(program);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
