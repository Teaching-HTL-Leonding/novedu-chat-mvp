import { binStarts } from "@/lib/diagnostics-range";
import type { DiagnosticsDto, ImpactBin, LlmBin } from "@/lib/diagnostics-shape";

// The golden test fixture of the diagnostics report: the SCCH incident of
// 2026-09-25 on the old production environment (docs/diagnostics.md). Between
// 07:21 and 07:48 UTC the header wait of SCCH calls rose from ~2 s to 15–20 s and
// ten calls failed with a 503 after almost exactly 15.1 s — an upstream timeout —
// each one a broken tutor turn (CopilotKit's INCOMPLETE_STREAM). Hand-built from
// the live query results, trimmed to 05:00–09:00 UTC. Test-only.

const FROM = "2026-09-25T05:00:00.000Z";
const TO = "2026-09-25T09:00:00.000Z";

const BIN_KEYS = binStarts(new Date(FROM), new Date(TO), "5m").map((d) => d.toISOString());

type Sparse = { calls: number; serverError?: number; p50: number; p95: number };

function llmBins(sparse: Record<string, Sparse>): LlmBin[] {
  return BIN_KEYS.map((key) => {
    const s = sparse[key.slice(11, 16)];
    const serverError = s?.serverError ?? 0;
    const calls = s?.calls ?? 0;
    return {
      key,
      t: Date.parse(key),
      ok: calls - serverError,
      rateLimited: 0,
      clientError: 0,
      serverError,
      noResponse: 0,
      calls,
      errors: serverError,
      p50Ms: s ? s.p50 : null,
      p95Ms: s ? s.p95 : null,
    };
  });
}

const QUIET: Sparse = { calls: 2, p50: 1_900, p95: 2_900 };
const RECOVERED: Sparse = { calls: 2, p50: 2_900, p95: 3_700 };

const SCCH_BINS: Record<string, Sparse> = {
  ...Object.fromEntries(
    BIN_KEYS.map((k) => k.slice(11, 16))
      .filter((t) => t >= "05:30" && t <= "07:15")
      .map((t) => [t, QUIET]),
  ),
  "07:20": { calls: 5, p50: 6_200, p95: 20_300 },
  "07:25": { calls: 6, serverError: 2, p50: 18_900, p95: 20_400 },
  "07:30": { calls: 14, p50: 12_000, p95: 25_700 },
  "07:35": { calls: 9, serverError: 4, p50: 15_100, p95: 20_100 },
  "07:40": { calls: 7, serverError: 2, p50: 15_200, p95: 19_800 },
  "07:45": { calls: 6, serverError: 2, p50: 15_100, p95: 31_200 },
  "07:50": { calls: 3, p50: 2_500, p95: 3_100 },
  "07:55": RECOVERED,
  "08:00": RECOVERED,
  "08:05": RECOVERED,
  "08:10": RECOVERED,
};

const FAILED_TURNS: Record<string, number> = { "07:25": 1, "07:35": 2, "07:40": 1, "07:45": 2 };

const impactBins: ImpactBin[] = BIN_KEYS.map((key) => {
  const hhmm = key.slice(11, 16);
  const busy = hhmm >= "05:30" && hhmm <= "08:10";
  return {
    key,
    t: Date.parse(key),
    failedTurns: FAILED_TURNS[hhmm] ?? 0,
    turns: busy ? 1 : 0,
    p95Ms: busy ? (hhmm >= "07:20" && hhmm <= "07:45" ? 44_500 : 9_000) : null,
  };
});

export const INCIDENT_2026_09_25: DiagnosticsDto = {
  range: { from: FROM, to: TO, bin: "5m" },
  generatedAt: "2026-09-25T09:15:42.000Z",
  server: "novedu.at",
  telemetryMode: "azure",
  llm: {
    state: "ok",
    data: {
      providers: [
        {
          provider: "SCCH",
          rows: 44,
          calls: 102,
          errors: 10,
          failed: 10,
          errorRate: 10 / 102,
          p50Ms: 3_000,
          p95Ms: 25_300,
          maxMs: 31_200,
        },
      ],
      series: [{ provider: "SCCH", bins: llmBins(SCCH_BINS) }],
      sampling: { rows: 44, estimated: 102, ratio: 44 / 102 },
      totalFailed: 10,
    },
  },
  errors: {
    state: "ok",
    data: {
      rows: [
        {
          provider: "SCCH",
          resultCode: "503",
          count: 10,
          medianMs: 15_122,
          firstSeen: "2026-09-25T07:28:04.080Z",
          lastSeen: "2026-09-25T07:47:33.323Z",
        },
      ],
      capped: false,
    },
  },
  failedCalls: {
    state: "ok",
    data: {
      rows: [
        { time: "2026-09-25T07:47:33.323Z", itemCount: 1, durationMs: 15_122 },
        { time: "2026-09-25T07:45:06.259Z", itemCount: 1, durationMs: 15_150 },
        { time: "2026-09-25T07:42:21.429Z", itemCount: 2, durationMs: 15_111 },
        { time: "2026-09-25T07:38:02.153Z", itemCount: 4, durationMs: 15_152 },
        { time: "2026-09-25T07:28:04.080Z", itemCount: 2, durationMs: 15_134 },
      ].map((r) => ({
        ...r,
        provider: "SCCH" as const,
        resultCode: "503",
        outcome: "serverError" as const,
      })),
      capped: false,
    },
  },
  impact: {
    state: "ok",
    data: {
      failedTurns: 6,
      turns: 51,
      failedShare: 6 / 51,
      turnP95Ms: 44_500,
      groups: [{ module: "tutor", label: "INCOMPLETE_STREAM", count: 6 }],
      bins: impactBins,
    },
  },
};
