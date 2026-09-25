import { ERROR_BREAKDOWN_CAP, FAILED_SAMPLE_CAP } from "@/lib/diagnostics-kql";
import type { BinSize, DiagnosticsPreset } from "@/lib/diagnostics-range";
import { LLM_PROVIDERS, type LlmProvider } from "@/lib/llm/provider";
import type { TelemetryMode } from "@/lib/telemetry-mode";

// Raw App Insights result tables → the DTO the diagnostics page, its charts and
// the clipboard report all render (docs/diagnostics.md). Pure and client-safe:
// the DTO crosses to the browser (the copy button formats it), so it holds
// provider NAMES only — a host or endpoint URL is mapped away here and never
// leaves the server. Every count is an estimate (`sum(itemCount)` over sampled
// rows); durations are milliseconds.

// --- Query results (produced by lib/diagnostics-client.ts) -------------------

export type DiagnosticsFailure =
  | "not-configured"
  | "credential"
  | "forbidden"
  | "timeout"
  | "error";

export interface QueryTable {
  columns: { name: string; type: string }[];
  rows: unknown[][];
}

export type QueryResult =
  | { ok: true; table: QueryTable }
  | { ok: false; failure: DiagnosticsFailure };

// --- Provider mapping --------------------------------------------------------

export type ProviderLabel = LlmProvider | "other";

/** Lowercase, port-less, dot-less hostname → provider. Built by lib/diagnostics-hosts.ts. */
export type HostMap = Readonly<Record<string, LlmProvider>>;

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function providerForHost(host: string, map: HostMap): ProviderLabel {
  return map[normalizeHost(host)] ?? "other";
}

const PROVIDER_ORDER: readonly ProviderLabel[] = [...LLM_PROVIDERS, "other"];

/** `LLM_PROVIDERS` order (SCCH first), "other" last. */
export function sortProviders<T extends { provider: ProviderLabel }>(xs: readonly T[]): T[] {
  return [...xs].sort(
    (a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider),
  );
}

// --- DTO ---------------------------------------------------------------------

/** Outcome of one upstream call, by HTTP status only (a 503 is `success == true`). */
export type Outcome = "ok" | "rateLimited" | "clientError" | "serverError" | "noResponse";

/** Stack order of the calls chart (bottom → top). */
export const OUTCOMES: readonly Outcome[] = [
  "ok",
  "clientError",
  "rateLimited",
  "serverError",
  "noResponse",
];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  ok: "OK",
  clientError: "Other 4xx",
  rateLimited: "429 rate limited",
  serverError: "5xx",
  noResponse: "No response",
};

/** The outcomes that count toward a provider's error rate (not client-side 4xx). */
export const ERROR_OUTCOMES: readonly Outcome[] = ["rateLimited", "serverError", "noResponse"];

export type SectionState<T> =
  | { state: "ok"; data: T }
  | { state: "empty" }
  | { state: "unavailable"; failure: DiagnosticsFailure };

export interface ProviderStats {
  provider: ProviderLabel;
  /** Retained telemetry rows. */
  rows: number;
  /** Estimated calls. */
  calls: number;
  /** 5xx + 429 + no response. */
  errors: number;
  /** Every non-2xx/3xx call, incl. other 4xx — what the failed-call tables list. */
  failed: number;
  errorRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface LlmBin extends Record<Outcome, number> {
  /** Bin start, ISO. */
  key: string;
  /** Bin start, epoch ms (the chart's numeric x). */
  t: number;
  calls: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface ProviderSeries {
  provider: ProviderLabel;
  bins: LlmBin[];
}

export interface SamplingNote {
  rows: number;
  estimated: number;
  /** Share of calls that survived sampling as rows; null without calls. */
  ratio: number | null;
}

export interface LlmData {
  providers: ProviderStats[];
  series: ProviderSeries[];
  sampling: SamplingNote;
  /** All failed calls (non-2xx/3xx) across providers. */
  totalFailed: number;
}

export interface ErrorBreakdownRow {
  provider: ProviderLabel;
  /** The HTTP status as text; "" or "0" when no response arrived. */
  resultCode: string;
  count: number;
  medianMs: number | null;
  firstSeen: string;
  lastSeen: string;
}

export interface ErrorBreakdownData {
  rows: ErrorBreakdownRow[];
  capped: boolean;
}

export interface FailedCallRow {
  time: string;
  provider: ProviderLabel;
  resultCode: string;
  outcome: Outcome;
  durationMs: number;
  /** How many calls this sampled row stands for. */
  itemCount: number;
}

export interface FailedCallsData {
  rows: FailedCallRow[];
  capped: boolean;
}

export interface ImpactBin {
  key: string;
  t: number;
  failedTurns: number;
  turns: number;
  p95Ms: number | null;
}

export interface FailureGroup {
  module: string;
  /** The CopilotKit run-error code, else our failure kind. */
  label: string;
  count: number;
}

export interface StudentImpact {
  failedTurns: number;
  turns: number;
  failedShare: number | null;
  turnP95Ms: number | null;
  groups: FailureGroup[];
  bins: ImpactBin[];
}

/** Everything the page shows and the report copies — JSON-serialisable. */
export interface DiagnosticsDto {
  range: { from: string; to: string; bin: BinSize; preset?: DiagnosticsPreset; tz?: string };
  generatedAt: string;
  /** The app's own public host (never an upstream endpoint). */
  server: string;
  telemetryMode: TelemetryMode;
  llm: SectionState<LlmData>;
  errors: SectionState<ErrorBreakdownData>;
  failedCalls: SectionState<FailedCallsData>;
  impact: SectionState<StudentImpact>;
}

// --- Table access ------------------------------------------------------------

type Row = (name: string) => unknown;

/** Rows as by-name accessors; `undefined` when a required column is missing. */
function readTable(table: QueryTable, required: readonly string[]): Row[] | undefined {
  const index = new Map(table.columns.map((c, i) => [c.name, i]));
  if (required.some((name) => !index.has(name))) return undefined;
  return table.rows.map((row) => (name: string) => {
    const i = index.get(name);
    return i === undefined ? undefined : row[i];
  });
}

/** A count; a `sumif` over no matching rows can come back null. */
function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Re-keys a KQL datetime (`…T07:20:00Z`) to the `toISOString()` form of the bin keys. */
function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

const UNAVAILABLE_ERROR = { state: "unavailable", failure: "error" } as const;

function outcomeOf(value: unknown): Outcome {
  return OUTCOMES.includes(value as Outcome) ? (value as Outcome) : "noResponse";
}

// --- LLM calls ---------------------------------------------------------------

const LLM_COLUMNS = [
  "t",
  "host",
  "rows",
  "calls",
  "ok",
  "rateLimited",
  "clientError",
  "serverError",
  "noResponse",
  "p50",
  "p95",
  "maxWait",
] as const;

interface LlmAgg extends Record<Outcome, number> {
  rows: number;
  calls: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

function emptyAgg(): LlmAgg {
  return {
    rows: 0,
    calls: 0,
    ok: 0,
    rateLimited: 0,
    clientError: 0,
    serverError: 0,
    noResponse: 0,
    p50Ms: null,
    p95Ms: null,
    maxMs: null,
  };
}

// Two hosts only merge into one provider when both are unknown ("other"). Their
// percentiles cannot be combined exactly, so the merge keeps the worse one.
function mergeAgg(into: LlmAgg, row: Row): void {
  into.rows += num(row("rows"));
  into.calls += num(row("calls"));
  for (const o of OUTCOMES) into[o] += num(row(o));
  into.p50Ms = maxOrNull(into.p50Ms, numOrNull(row("p50")));
  into.p95Ms = maxOrNull(into.p95Ms, numOrNull(row("p95")));
  into.maxMs = maxOrNull(into.maxMs, numOrNull(row("maxWait")));
}

const errorsOf = (a: Record<Outcome, number>) => ERROR_OUTCOMES.reduce((sum, o) => sum + a[o], 0);

export function shapeLlm(
  result: QueryResult,
  range: { binKeys: readonly string[] },
  hosts: HostMap,
): SectionState<LlmData> {
  if (!result.ok) return { state: "unavailable", failure: result.failure };
  const rows = readTable(result.table, LLM_COLUMNS);
  if (!rows) return UNAVAILABLE_ERROR;
  if (rows.length === 0) return { state: "empty" };

  const totals = new Map<ProviderLabel, LlmAgg>();
  const bins = new Map<ProviderLabel, Map<string, LlmAgg>>();
  for (const row of rows) {
    const provider = providerForHost(str(row("host")), hosts);
    const key = isoOrNull(row("t"));
    if (key === null) {
      const agg = totals.get(provider) ?? emptyAgg();
      mergeAgg(agg, row);
      totals.set(provider, agg);
    } else {
      const byKey = bins.get(provider) ?? new Map<string, LlmAgg>();
      const agg = byKey.get(key) ?? emptyAgg();
      mergeAgg(agg, row);
      byKey.set(key, agg);
      bins.set(provider, byKey);
    }
  }

  const providers = sortProviders(
    [...totals].map(([provider, a]): ProviderStats => {
      const errors = errorsOf(a);
      return {
        provider,
        rows: a.rows,
        calls: a.calls,
        errors,
        failed: a.calls - a.ok,
        errorRate: a.calls > 0 ? errors / a.calls : null,
        p50Ms: a.p50Ms,
        p95Ms: a.p95Ms,
        maxMs: a.maxMs,
      };
    }),
  ).filter((p) => p.calls > 0);
  if (providers.length === 0) return { state: "empty" };

  const series = providers.map(({ provider }): ProviderSeries => {
    const byKey = bins.get(provider);
    return {
      provider,
      bins: range.binKeys.map((key): LlmBin => {
        const a = byKey?.get(key) ?? emptyAgg();
        return {
          key,
          t: Date.parse(key),
          ok: a.ok,
          rateLimited: a.rateLimited,
          clientError: a.clientError,
          serverError: a.serverError,
          noResponse: a.noResponse,
          calls: a.calls,
          errors: errorsOf(a),
          p50Ms: a.p50Ms,
          p95Ms: a.p95Ms,
        };
      }),
    };
  });

  const rowsTotal = providers.reduce((s, p) => s + p.rows, 0);
  const estimated = providers.reduce((s, p) => s + p.calls, 0);
  return {
    state: "ok",
    data: {
      providers,
      series,
      sampling: { rows: rowsTotal, estimated, ratio: estimated > 0 ? rowsTotal / estimated : null },
      totalFailed: providers.reduce((s, p) => s + p.failed, 0),
    },
  };
}

// --- Error breakdown ---------------------------------------------------------

const BREAKDOWN_COLUMNS = [
  "host",
  "resultCode",
  "errors",
  "medianWait",
  "firstSeen",
  "lastSeen",
] as const;

export function shapeErrorBreakdown(
  result: QueryResult,
  hosts: HostMap,
): SectionState<ErrorBreakdownData> {
  if (!result.ok) return { state: "unavailable", failure: result.failure };
  const rows = readTable(result.table, BREAKDOWN_COLUMNS);
  if (!rows) return UNAVAILABLE_ERROR;
  if (rows.length === 0) return { state: "empty" };

  // Two unknown hosts with the same status fold into one "other" row.
  const merged = new Map<string, ErrorBreakdownRow>();
  for (const row of rows) {
    const provider = providerForHost(str(row("host")), hosts);
    const resultCode = str(row("resultCode"));
    const firstSeen = isoOrNull(row("firstSeen")) ?? "";
    const lastSeen = isoOrNull(row("lastSeen")) ?? "";
    const key = `${provider}\u0000${resultCode}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, {
        provider,
        resultCode,
        count: num(row("errors")),
        medianMs: numOrNull(row("medianWait")),
        firstSeen,
        lastSeen,
      });
      continue;
    }
    prev.count += num(row("errors"));
    prev.medianMs = maxOrNull(prev.medianMs, numOrNull(row("medianWait")));
    if (firstSeen && (!prev.firstSeen || firstSeen < prev.firstSeen)) prev.firstSeen = firstSeen;
    if (lastSeen > prev.lastSeen) prev.lastSeen = lastSeen;
  }
  const out = [...merged.values()].sort(
    (a, b) =>
      b.count - a.count ||
      PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider) ||
      a.resultCode.localeCompare(b.resultCode),
  );
  return { state: "ok", data: { rows: out, capped: rows.length >= ERROR_BREAKDOWN_CAP } };
}

// --- Failed-call sample ------------------------------------------------------

const SAMPLE_COLUMNS = [
  "timestamp",
  "host",
  "resultCode",
  "outcome",
  "duration",
  "itemCount",
] as const;

export function shapeFailedCalls(
  result: QueryResult,
  hosts: HostMap,
): SectionState<FailedCallsData> {
  if (!result.ok) return { state: "unavailable", failure: result.failure };
  const rows = readTable(result.table, SAMPLE_COLUMNS);
  if (!rows) return UNAVAILABLE_ERROR;
  if (rows.length === 0) return { state: "empty" };
  const out = rows
    .map(
      (row): FailedCallRow => ({
        time: isoOrNull(row("timestamp")) ?? "",
        provider: providerForHost(str(row("host")), hosts),
        resultCode: str(row("resultCode")),
        outcome: outcomeOf(row("outcome")),
        durationMs: num(row("duration")),
        itemCount: Math.max(1, num(row("itemCount"))),
      }),
    )
    .sort((a, b) => b.time.localeCompare(a.time));
  return { state: "ok", data: { rows: out, capped: rows.length >= FAILED_SAMPLE_CAP } };
}

// --- Student impact ----------------------------------------------------------

const FAILURE_COLUMNS = ["t", "module", "failure", "code", "failed"] as const;
const TURN_COLUMNS = ["t", "turns", "p95"] as const;

export function shapeImpact(
  failures: QueryResult,
  turns: QueryResult,
  range: { binKeys: readonly string[] },
): SectionState<StudentImpact> {
  if (!failures.ok) return { state: "unavailable", failure: failures.failure };
  if (!turns.ok) return { state: "unavailable", failure: turns.failure };
  const failureRows = readTable(failures.table, FAILURE_COLUMNS);
  const turnRows = readTable(turns.table, TURN_COLUMNS);
  if (!failureRows || !turnRows) return UNAVAILABLE_ERROR;

  const failedByKey = new Map<string, number>();
  const groups = new Map<string, FailureGroup>();
  let failedTurns = 0;
  for (const row of failureRows) {
    const count = num(row("failed"));
    failedTurns += count;
    const key = isoOrNull(row("t"));
    if (key !== null) failedByKey.set(key, (failedByKey.get(key) ?? 0) + count);
    const module = str(row("module")) || "unknown";
    const label = str(row("code")) || str(row("failure")) || "unknown";
    const groupKey = `${module}\u0000${label}`;
    const group = groups.get(groupKey) ?? { module, label, count: 0 };
    group.count += count;
    groups.set(groupKey, group);
  }

  const turnsByKey = new Map<string, { turns: number; p95Ms: number | null }>();
  let totalTurns = 0;
  let turnP95Ms: number | null = null;
  for (const row of turnRows) {
    const key = isoOrNull(row("t"));
    if (key === null) {
      totalTurns += num(row("turns"));
      turnP95Ms = maxOrNull(turnP95Ms, numOrNull(row("p95")));
    } else {
      turnsByKey.set(key, { turns: num(row("turns")), p95Ms: numOrNull(row("p95")) });
    }
  }

  if (totalTurns === 0 && failedTurns === 0) return { state: "empty" };

  return {
    state: "ok",
    data: {
      failedTurns,
      turns: totalTurns,
      // Both sides are sampled independently, so the estimate can overshoot.
      failedShare: totalTurns > 0 ? Math.min(1, failedTurns / totalTurns) : null,
      turnP95Ms,
      groups: [...groups.values()].sort(
        (a, b) =>
          b.count - a.count || a.module.localeCompare(b.module) || a.label.localeCompare(b.label),
      ),
      bins: range.binKeys.map((key) => ({
        key,
        t: Date.parse(key),
        failedTurns: failedByKey.get(key) ?? 0,
        turns: turnsByKey.get(key)?.turns ?? 0,
        p95Ms: turnsByKey.get(key)?.p95Ms ?? null,
      })),
    },
  };
}
