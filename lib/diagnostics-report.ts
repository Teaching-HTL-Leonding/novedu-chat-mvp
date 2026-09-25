import { ERROR_BREAKDOWN_CAP } from "@/lib/diagnostics-kql";
import type {
  DiagnosticsDto,
  ErrorBreakdownRow,
  FailedCallRow,
  LlmBin,
  ProviderStats,
} from "@/lib/diagnostics-shape";

// The diagnostics page's DTO → the plain-text report its "Copy report" button puts
// on the clipboard for a support case (docs/diagnostics.md). Built from the SAME
// DTO the page renders, so the two can never disagree. Pure and client-safe; the
// only environment input is the viewer's time zone, named on the Range line.
//
// Plain text that also reads as Markdown. Every timestamp is ISO UTC (the local
// zone appears only once, beside the range). Provider NAMES only — the DTO holds no
// host or URL by construction — and no user ids, codes or content.

/** Rows of the per-provider timeline, at most. */
export const REPORT_TIMELINE_CAP = 48;

/** A bin is "slow" when its p95 reaches this multiple of the range's p50. */
const SLOW_FACTOR = 3;

const count = (n: number) => Math.round(n).toLocaleString("en-US");

/** `—` · `850 ms` · `15.1 s` · `1 min 12 s`. */
export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** `8.2 %`, or `—` without a ratio. */
export function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${(ratio * 100).toFixed(1)} %`;
}

/** The zone's UTC offset at an instant: `UTC+2`, `UTC-4`, `UTC+5:30`, `UTC+0`. */
export function utcOffsetLabel(at: Date, timeZone: string): string {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!m) return "UTC+0";
  const hours = String(Number(m[2]));
  return `UTC${m[1]}${hours}${m[3] === "00" ? "" : `:${m[3]}`}`;
}

// --- Time formatting ---------------------------------------------------------

/** ISO UTC without milliseconds, and without seconds when they are zero. */
function isoUtc(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z").replace(/(T\d{2}:\d{2}):00Z$/, "$1Z");
}

/** ISO UTC to the second, without milliseconds. */
function isoSeconds(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function localRange(from: Date, to: Date, timeZone: string): string {
  const a = localParts(from, timeZone);
  const b = localParts(to, timeZone);
  const span =
    a.date === b.date ? `${a.time}–${b.time}` : `${a.date} ${a.time}–${b.date} ${b.time}`;
  const offFrom = utcOffsetLabel(from, timeZone);
  const offTo = utcOffsetLabel(to, timeZone);
  const offset = offFrom === offTo ? offFrom : `${offFrom}→${offTo.replace(/^UTC/, "")}`;
  return `local ${span}, ${timeZone}, ${offset}`;
}

/** `HH:mm:ssZ`, or `MM-DD HH:mm:ssZ` when the range spans several UTC days. */
function clock(iso: string, multiDay: boolean, withSeconds = true): string {
  const d = isoSeconds(iso);
  const time = withSeconds ? d.slice(11, 19) : d.slice(11, 16);
  return multiDay ? `${d.slice(5, 10)} ${time}Z` : `${time}Z`;
}

// --- Sections ----------------------------------------------------------------

const INDENT = "  ";

function unavailable(label: string, section: { failure: string }): string {
  return `${label}: unavailable (${section.failure})`;
}

function statusLabel(code: string): string {
  return code === "" || code === "0" ? "(no response)" : code;
}

function errorsByStatus(rows: ErrorBreakdownRow[], multiDay: boolean, capped: boolean): string[] {
  const head = `${INDENT}${"Errors by status".padEnd(16)} ${"count".padStart(6)}  ${"median wait".padStart(11)}  ${"first seen (UTC)".padEnd(18)}last seen (UTC)`;
  const lines = rows.map(
    (r) =>
      `${INDENT}${statusLabel(r.resultCode).padEnd(16)} ${count(r.count).padStart(6)}  ${formatDurationMs(r.medianMs).padStart(11)}  ${clock(r.firstSeen, multiDay).padEnd(18)}${clock(r.lastSeen, multiDay)}`,
  );
  const note = capped
    ? [`${INDENT}(the top ${ERROR_BREAKDOWN_CAP} provider × status groups of the range)`]
    : [];
  return [head, ...lines, ...note];
}

function timeline(provider: ProviderStats, bins: LlmBin[], multiDay: boolean): string[] {
  const p50 = provider.p50Ms;
  const notable = bins.filter(
    (b) =>
      b.errors > 0 || (p50 !== null && p50 > 0 && b.p95Ms !== null && b.p95Ms >= SLOW_FACTOR * p50),
  );
  if (notable.length === 0) return [];
  const shown = [...notable]
    .sort((a, b) => b.errors - a.errors || (b.p95Ms ?? 0) - (a.p95Ms ?? 0) || a.t - b.t)
    .slice(0, REPORT_TIMELINE_CAP)
    .sort((a, b) => a.t - b.t);
  const timeWidth = multiDay ? 13 : 9;
  return [
    `${INDENT}Timeline (bins with errors or p95 ≥ ${SLOW_FACTOR}× the range's p50, showing ${shown.length} of ${notable.length})`,
    `${INDENT}${"bin (UTC)".padEnd(timeWidth)}  ${"calls".padStart(6)}  ${"errors".padStart(6)}  ${"p50".padStart(8)}  ${"p95".padStart(8)}`,
    ...shown.map(
      (b) =>
        `${INDENT}${clock(b.key, multiDay, false).padEnd(timeWidth)}  ${count(b.calls).padStart(6)}  ${count(b.errors).padStart(6)}  ${formatDurationMs(b.p50Ms).padStart(8)}  ${formatDurationMs(b.p95Ms).padStart(8)}`,
    ),
  ];
}

function failedCalls(rows: FailedCallRow[], total: number, multiDay: boolean): string[] {
  return [
    `${INDENT}Failed calls (sample, showing ${rows.length} of ≈ ${count(total)}) — time (UTC), status, duration`,
    ...rows.map((r) => {
      const weight = r.itemCount > 1 ? `  (stands for ${count(r.itemCount)})` : "";
      return `${INDENT}${clock(r.time, multiDay)}  ${statusLabel(r.resultCode).padEnd(13)}  ${formatDurationMs(r.durationMs).padStart(8)}${weight}`;
    }),
  ];
}

function providerBlocks(dto: DiagnosticsDto, multiDay: boolean): string[] {
  const llm = dto.llm;
  if (llm.state === "unavailable") return [unavailable("LLM calls", llm)];
  if (llm.state === "empty") return ["No LLM calls in this range."];
  const { providers, series } = llm.data;

  const out: string[] = [];
  for (const p of providers) {
    if (out.length > 0) out.push("");
    out.push(
      `Provider ${p.provider} — ${count(p.calls)} calls, ${formatPercent(p.errorRate)} errors; wait for response headers p50 ${formatDurationMs(p.p50Ms)} / p95 ${formatDurationMs(p.p95Ms)} / max ${formatDurationMs(p.maxMs)}`,
    );

    if (p.failed === 0) {
      out.push(`${INDENT}No errors.`);
    } else if (dto.errors.state === "unavailable") {
      out.push(`${INDENT}Errors by status: unavailable (${dto.errors.failure})`);
    } else if (dto.errors.state === "ok") {
      const rows = dto.errors.data.rows.filter((r) => r.provider === p.provider);
      out.push(...errorsByStatus(rows, multiDay, dto.errors.data.capped));
    }

    const bins = series.find((s) => s.provider === p.provider)?.bins ?? [];
    out.push(...timeline(p, bins, multiDay));

    if (p.failed > 0) {
      if (dto.failedCalls.state === "unavailable") {
        out.push(`${INDENT}Failed calls: unavailable (${dto.failedCalls.failure})`);
      } else if (dto.failedCalls.state === "ok") {
        const rows = dto.failedCalls.data.rows.filter((r) => r.provider === p.provider);
        if (rows.length > 0) out.push(...failedCalls(rows, p.failed, multiDay));
      }
    }
  }
  return out;
}

function impactLine(dto: DiagnosticsDto): string {
  const impact = dto.impact;
  if (impact.state === "unavailable") return unavailable("Student impact", impact);
  if (impact.state === "empty") return "Student impact — no chat turns in this range.";
  const i = impact.data;
  const byModule = new Map<string, string[]>();
  for (const g of i.groups) {
    byModule.set(g.module, [...(byModule.get(g.module) ?? []), `${g.label} ${count(g.count)}`]);
  }
  const groups =
    byModule.size > 0
      ? ` (${[...byModule].map(([m, labels]) => `${m}: ${labels.join(", ")}`).join("; ")})`
      : "";
  const share = i.turns > 0 ? ` — ${formatPercent(i.failedShare)} of ${count(i.turns)} turns` : "";
  return `Student impact — ${count(i.failedTurns)} failed chat turns${groups}${share}; chat turn p95 ${formatDurationMs(i.turnP95Ms)}`;
}

// --- Report ------------------------------------------------------------------

export function formatDiagnosticsReport(dto: DiagnosticsDto, locale: { timeZone: string }): string {
  const from = new Date(dto.range.from);
  const to = new Date(dto.range.to);
  const multiDay =
    dto.range.from.slice(0, 10) !== new Date(to.getTime() - 1).toISOString().slice(0, 10);

  const sampling =
    dto.llm.state === "ok" && dto.llm.data.sampling.ratio !== null
      ? `counts are estimates from sampled telemetry (≈ ${Math.round(dto.llm.data.sampling.ratio * 100)} % of rows retained)`
      : "counts are estimates from sampled telemetry";

  const lines = [
    "Novedu — LLM diagnostics",
    `Range:     ${isoUtc(dto.range.from)} – ${isoUtc(dto.range.to)}  (${localRange(from, to, locale.timeZone)})`,
    `Server:    ${dto.server}        Generated: ${isoSeconds(dto.generatedAt)}`,
    `Note:      ${sampling}`,
  ];
  if (dto.telemetryMode !== "azure") {
    lines.push(
      `Note:      this server does not send telemetry to Application Insights (mode: ${dto.telemetryMode}); its own recent data may be missing`,
    );
  }
  lines.push("", ...providerBlocks(dto, multiDay), "", impactLine(dto));
  return `${lines.join("\n")}\n`;
}
