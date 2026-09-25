import type { BinSize } from "@/lib/diagnostics-range";

// The KQL behind the LLM diagnostics page (docs/diagnostics.md). Pure string
// builders: the ONLY values that reach a query are two validated `Date`s (as ISO
// literals) and the `BinSize` enum (through a fixed lookup) — nothing the user
// types, and no host literal either: hosts are grouped here and mapped to provider
// names on the server (lib/diagnostics-hosts.ts), so there is nothing to escape.
//
// Written against the App Insights RESOURCE query endpoint, so the classic table
// names apply (`dependencies`, `requests`, `timestamp`, `itemCount`,
// `customDimensions`, …), not the workspace `App*` ones. Facts the queries rely on
// (verified against live data; docs/diagnostics.md):
//   - An upstream LLM call is a Next `fetch` span: `type =~ "HTTP"` (the exporter
//     sends `Http`, so the match is case-insensitive), `name` =
//     `POST …/chat/completions`, `target` = the full URL. Its `duration` ends when
//     the response HEADERS arrive — the wait before streaming starts.
//   - A `target` that is a bare host (no scheme) has no `parse_url` host, so the
//     host falls back to the raw `target`.
//   - A 503 carries `success == true`: outcomes come from `resultCode` only.
//   - Telemetry is sampled: every count is `sum(itemCount)`, every percentile is
//     weighted by it.
//   - `recordError()` lands on a `dependencies` row with `target == "exception"`,
//     its attributes in `customDimensions`.
//   - Requests are nested; only top-level rows (`operation_ParentId ==
//     operation_Id`) carry the concrete `POST /api/copilotkit/agent/<id>/run` name.
//
// Imports only a type, so it stays pure and client-safe.

export type DiagnosticsQueryName =
  | "llmCalls"
  | "llmErrorBreakdown"
  | "llmFailedSample"
  | "chatFailures"
  | "chatTurns";

export interface KqlWindow {
  from: Date;
  to: Date;
  bin: BinSize;
}

/** Row caps, applied IN the query (`top`), so no result can grow unbounded. */
export const ERROR_BREAKDOWN_CAP = 20;
export const FAILED_SAMPLE_CAP = 50;

const BIN_LITERAL: Record<BinSize, string> = { "1m": "1m", "5m": "5m", "1h": "1h", "6h": "6h" };

const dt = (d: Date) => `datetime(${d.toISOString()})`;

const timeFilter = (w: KqlWindow) =>
  `| where timestamp >= ${dt(w.from)} and timestamp < ${dt(w.to)}`;

const binBy = (w: KqlWindow) => `t = bin_at(timestamp, ${BIN_LITERAL[w.bin]}, ${dt(w.from)})`;

/** The upstream LLM calls with a provider host and a classified outcome. */
function llmPrelude(w: KqlWindow): string {
  return [
    "let llm = dependencies",
    timeFilter(w),
    '| where type =~ "HTTP" and name endswith "/chat/completions"',
    "| extend host = tolower(tostring(parse_url(target).Host))",
    "| extend host = iff(isempty(host), tolower(target), host)",
    "| extend code = toint(resultCode)",
    "| extend outcome = case(",
    '    isnull(code) or code == 0, "noResponse",',
    '    code == 429, "rateLimited",',
    '    code >= 500, "serverError",',
    '    code >= 400, "clientError",',
    '    "ok");',
  ].join("\n");
}

// One aggregate list for the per-bin and the whole-range branch of Q1, so the two
// can never drift apart.
const LLM_AGGREGATES = [
  "rows = count()",
  "calls = sum(itemCount)",
  'ok = sumif(itemCount, outcome == "ok")',
  'rateLimited = sumif(itemCount, outcome == "rateLimited")',
  'clientError = sumif(itemCount, outcome == "clientError")',
  'serverError = sumif(itemCount, outcome == "serverError")',
  'noResponse = sumif(itemCount, outcome == "noResponse")',
  "(p50, p95) = percentilesw(duration, itemCount, 50, 95)",
  "maxWait = max(duration)",
].join(", ");

/** Q1 — per host: calls by outcome + header-wait percentiles, per bin AND for the whole range (`t` null). */
export function buildLlmCallsQuery(w: KqlWindow): string {
  return [
    llmPrelude(w),
    "llm",
    `| summarize ${LLM_AGGREGATES} by ${binBy(w)}, host`,
    `| union (llm | summarize ${LLM_AGGREGATES} by host | extend t = datetime(null))`,
    "| order by host asc, t asc",
  ].join("\n");
}

/** Q2 — non-2xx calls by host × status, the biggest groups first. */
export function buildLlmErrorBreakdownQuery(w: KqlWindow): string {
  return [
    llmPrelude(w),
    "llm",
    '| where outcome != "ok"',
    "| summarize errors = sum(itemCount), medianWait = percentilew(duration, itemCount, 50),",
    "    firstSeen = min(timestamp), lastSeen = max(timestamp) by host, resultCode",
    `| top ${ERROR_BREAKDOWN_CAP} by errors desc`,
  ].join("\n");
}

/** Q3 — the newest sampled failed calls. */
export function buildLlmFailedSampleQuery(w: KqlWindow): string {
  return [
    llmPrelude(w),
    "llm",
    '| where outcome != "ok"',
    `| top ${FAILED_SAMPLE_CAP} by timestamp desc`,
    "| project timestamp, host, resultCode, outcome, duration, itemCount",
  ].join("\n");
}

/** Q4 — failed chat turns (recordError rows of area `chat-run`) per bin, module and failure. */
export function buildChatFailuresQuery(w: KqlWindow): string {
  return [
    "dependencies",
    timeFilter(w),
    '| where type == "Dependency" and target == "exception" and name == "exception"',
    '| where tostring(customDimensions["novedu.area"]) == "chat-run"',
    '| extend module = tostring(customDimensions["novedu.module"]),',
    '    failure = tostring(customDimensions["novedu.chat.failure"]),',
    '    code = tostring(customDimensions["novedu.chat.run_error_code"])',
    `| summarize failed = sum(itemCount) by ${binBy(w)}, module, failure, code`,
    "| order by t asc",
  ].join("\n");
}

/** Q5 — student chat turns and their p95 duration, per bin AND for the whole range (`t` null). */
export function buildChatTurnsQuery(w: KqlWindow): string {
  const aggregates = "turns = sum(itemCount), p95 = percentilew(duration, itemCount, 95)";
  return [
    "let chatTurns = requests",
    timeFilter(w),
    "| where operation_ParentId == operation_Id",
    '| where name startswith "POST /api/copilotkit/agent/" and name endswith "/run";',
    "chatTurns",
    `| summarize ${aggregates} by ${binBy(w)}`,
    `| union (chatTurns | summarize ${aggregates} | extend t = datetime(null))`,
    "| order by t asc",
  ].join("\n");
}

export function buildDiagnosticsQueries(w: KqlWindow): Record<DiagnosticsQueryName, string> {
  return {
    llmCalls: buildLlmCallsQuery(w),
    llmErrorBreakdown: buildLlmErrorBreakdownQuery(w),
    llmFailedSample: buildLlmFailedSampleQuery(w),
    chatFailures: buildChatFailuresQuery(w),
    chatTurns: buildChatTurnsQuery(w),
  };
}
