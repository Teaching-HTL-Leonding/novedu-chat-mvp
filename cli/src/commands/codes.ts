import type { Command } from "commander";
import { runApiRequest } from "../api";

// Teacher code management over the bearer API (docs/api.md): mint a code with
// the same validation pipeline as the web form, and list codes with the /codes
// page's filters. JSON in/out — see cli/src/api.ts for the output contract.

const SERVER_OPTION = [
  "--server <url>",
  "Novedu server base URL (defaults to the NOVEDU_SERVER env var, then production)",
] as const;

interface CreateOptions {
  server?: string;
  module: string;
  file: string;
  start?: string;
  end?: string;
  note?: string;
  llmProvider?: string;
  llmModel?: string;
}

interface ListOptions {
  server?: string;
  search?: string;
  module?: string;
  all?: boolean;
}

export function registerCodes(program: Command): void {
  const codes = program.command("codes").description("Manage activity codes on the Novedu server");

  codes
    .command("create")
    .description("Create a code for an activity YAML (validated server-side before storing)")
    .requiredOption("--module <module>", "activity module: tutor, quiz, writing or coding")
    .requiredOption("--file <url>", "public http(s) URL of the activity YAML")
    .option(
      "--start <iso>",
      "window start, ISO 8601 with explicit offset (e.g. 2026-07-07T08:00:00Z)",
    )
    .option("--end <iso>", "window end, ISO 8601 with explicit offset")
    .option("--note <text>", "note shown in the codes list")
    .option(
      "--llm-provider <provider>",
      'LLM override provider ("SCCH" or "Azure Foundry"; needs --llm-model)',
    )
    .option("--llm-model <model>", "LLM override model id (needs --llm-provider)")
    .option(...SERVER_OPTION)
    .action(async (options: CreateOptions) => {
      // --start/--end pass through verbatim; the API enforces the explicit-offset
      // rule. The llm pair's both-or-nothing rule is also the server's call.
      await runApiRequest({
        server: options.server,
        path: "/api/codes",
        method: "POST",
        body: {
          module: options.module,
          fileUrl: options.file,
          ...(options.start === undefined ? {} : { validFrom: options.start }),
          ...(options.end === undefined ? {} : { validUntil: options.end }),
          ...(options.note === undefined ? {} : { note: options.note }),
          ...(options.llmProvider === undefined && options.llmModel === undefined
            ? {}
            : { llm: { provider: options.llmProvider ?? "", model: options.llmModel ?? "" } }),
        },
      });
    });

  codes
    .command("list")
    .description("List codes (defaults to only your own, like the web list)")
    .option("--search <q>", "contains-filter over note/code")
    .option("--module <module>", "only codes for one activity module")
    .option("--all", "include codes created by other teachers")
    .option(...SERVER_OPTION)
    .action(async (options: ListOptions) => {
      const params = new URLSearchParams();
      if (options.search) params.set("q", options.search);
      if (options.module) params.set("module", options.module);
      if (options.all) params.set("mine", "0");
      const query = params.toString();
      await runApiRequest({
        server: options.server,
        path: `/api/codes${query ? `?${query}` : ""}`,
      });
    });
}
