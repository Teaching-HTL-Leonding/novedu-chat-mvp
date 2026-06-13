#!/usr/bin/env node
import { Command } from "commander";
import { registerValidate } from "./commands/validate";

// Entry point for the `novedu-tutor` CLI. Each feature registers itself as a
// subcommand; today that's `validate`, with more to follow.
const program = new Command();

program
  .name("novedu-tutor")
  .description("Command-line companion for the Novedu chat app")
  .version("0.1.0");

registerValidate(program);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
