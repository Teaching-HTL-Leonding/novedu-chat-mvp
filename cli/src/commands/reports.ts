import type { Command } from "commander";
import { runApiRequest } from "../api";

// Teacher report triage over the bearer API (docs/api.md): list reports with
// the /reports inbox's filters, show one report (a chat report embeds its
// transcript), and resolve reports in bulk by id. JSON in/out — see
// cli/src/api.ts for the output contract. No client-side validation of ids or
// enum values — the server is the authority and rejects unknown values with 400.

const SERVER_OPTION = [
  "--server <url>",
  "Novedu server base URL (defaults to the NOVEDU_SERVER env var, then production)",
] as const;

interface ListOptions {
  server?: string;
  status?: string;
  reaction?: string;
  search?: string;
  all?: boolean;
}

interface ShowOptions {
  server?: string;
}

interface ResolveOptions {
  server?: string;
}

export function registerReports(program: Command): void {
  const reports = program
    .command("reports")
    .description("Triage student reports on the Novedu server");

  reports
    .command("list")
    .description("List reports (defaults to open reports on your own codes, like the web inbox)")
    .option("--status <status>", "open (default), resolved or all")
    .option("--reaction <reaction>", "filter by reaction: good, omg, bad or holysh")
    .option("--search <q>", "contains-filter over description, reporter, code and note")
    .option("--all", "include reports on codes created by other teachers")
    .option(...SERVER_OPTION)
    .action(async (options: ListOptions) => {
      // --status/--reaction pass through verbatim; the API rejects unknown
      // values with 400. Sending no params matches the inbox defaults (open,
      // mine); --all widens to all teachers' codes.
      const params = new URLSearchParams();
      if (options.status) params.set("status", options.status);
      if (options.reaction) params.set("reaction", options.reaction);
      if (options.search) params.set("q", options.search);
      if (options.all) params.set("mine", "0");
      const query = params.toString();
      await runApiRequest({
        server: options.server,
        path: `/api/reports${query ? `?${query}` : ""}`,
      });
    });

  reports
    .command("show <id>")
    .description("Show one report; a chat report embeds its conversation transcript")
    .option(...SERVER_OPTION)
    .action(async (id: string, options: ShowOptions) => {
      await runApiRequest({
        server: options.server,
        path: `/api/reports/${encodeURIComponent(id)}`,
      });
    });

  reports
    .command("resolve <id...>")
    .description("Resolve one or more reports by id (bulk, in a single request)")
    .option(...SERVER_OPTION)
    .action(async (ids: string[], options: ResolveOptions) => {
      await runApiRequest({
        server: options.server,
        path: "/api/reports/resolve",
        method: "POST",
        body: { ids },
      });
    });
}
