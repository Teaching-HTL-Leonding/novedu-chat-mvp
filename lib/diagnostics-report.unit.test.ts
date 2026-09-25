// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  formatDiagnosticsReport,
  formatDurationMs,
  formatPercent,
  REPORT_TIMELINE_CAP,
  utcOffsetLabel,
} from "@/lib/diagnostics-report";
import { INCIDENT_2026_09_25 } from "@/lib/diagnostics-report.fixture";
import type { DiagnosticsDto, LlmBin } from "@/lib/diagnostics-shape";

// The clipboard report is pasted into support cases, so its text is pinned
// verbatim against the 2026-09-25 SCCH incident (lib/diagnostics-report.fixture.ts).

const VIENNA = { timeZone: "Europe/Vienna" };

const GOLDEN = `Novedu — LLM diagnostics
Range:     2026-09-25T05:00Z – 2026-09-25T09:00Z  (local 07:00–11:00, Europe/Vienna, UTC+2)
Server:    novedu.at        Generated: 2026-09-25T09:15:42Z
Note:      counts are estimates from sampled telemetry (≈ 43 % of rows retained)

Provider SCCH — 102 calls, 9.8 % errors; wait for response headers p50 3.0 s / p95 25.3 s / max 31.2 s
  Errors by status  count  median wait  first seen (UTC)  last seen (UTC)
  503                  10       15.1 s  07:28:04Z         07:47:33Z
  Timeline (bins with errors or p95 ≥ 3× the range's p50, showing 6 of 6)
  bin (UTC)   calls  errors       p50       p95
  07:20Z          5       0     6.2 s    20.3 s
  07:25Z          6       2    18.9 s    20.4 s
  07:30Z         14       0    12.0 s    25.7 s
  07:35Z          9       4    15.1 s    20.1 s
  07:40Z          7       2    15.2 s    19.8 s
  07:45Z          6       2    15.1 s    31.2 s
  Failed calls (sample, showing 5 of ≈ 10) — time (UTC), status, duration
  07:47:33Z  503              15.1 s
  07:45:06Z  503              15.2 s
  07:42:21Z  503              15.1 s  (stands for 2)
  07:38:02Z  503              15.2 s  (stands for 4)
  07:28:04Z  503              15.1 s  (stands for 2)

Student impact — 6 failed chat turns (tutor: INCOMPLETE_STREAM 6) — 11.8 % of 51 turns; chat turn p95 44.5 s
`;

describe("formatDiagnosticsReport", () => {
  it("renders the 2026-09-25 incident verbatim", () => {
    expect(formatDiagnosticsReport(INCIDENT_2026_09_25, VIENNA)).toBe(GOLDEN);
  });

  it("names no endpoint and carries no tabs or CRs", () => {
    const text = formatDiagnosticsReport(INCIDENT_2026_09_25, VIENNA);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain("scch.at");
    expect(text).not.toMatch(/[\t\r]/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("names the viewer's zone only on the Range line", () => {
    const text = formatDiagnosticsReport(INCIDENT_2026_09_25, { timeZone: "America/New_York" });
    expect(text).toContain("(local 01:00–05:00, America/New_York, UTC-4)");
    expect(text.split("\n").filter((l) => l.includes("America/New_York"))).toHaveLength(1);
  });

  it("shows local dates and the offset change for a range across a DST switch", () => {
    const dto: DiagnosticsDto = {
      ...INCIDENT_2026_09_25,
      range: { from: "2026-10-24T22:00:00.000Z", to: "2026-10-25T23:00:00.000Z", bin: "1h" },
    };
    const range = formatDiagnosticsReport(dto, VIENNA).split("\n")[1];
    expect(range).toBe(
      "Range:     2026-10-24T22:00Z – 2026-10-25T23:00Z  (local 2026-10-25 00:00–2026-10-26 00:00, Europe/Vienna, UTC+2→+1)",
    );
  });

  it("prefixes the date on times of a multi-day range", () => {
    const dto: DiagnosticsDto = {
      ...INCIDENT_2026_09_25,
      range: { from: "2026-09-24T09:00:00.000Z", to: "2026-09-25T09:00:00.000Z", bin: "1h" },
    };
    const text = formatDiagnosticsReport(dto, VIENNA);
    expect(text).toContain(
      "  503                  10       15.1 s  09-25 07:28:04Z   09-25 07:47:33Z",
    );
    expect(text).toContain("  09-25 07:47:33Z  503");
  });

  it("caps the timeline and keeps the worst bins in time order", () => {
    const base = INCIDENT_2026_09_25.llm;
    if (base.state !== "ok") throw new Error("fixture");
    const bins: LlmBin[] = Array.from({ length: 60 }, (_, i) => {
      const t = Date.parse("2026-09-25T05:00:00Z") + i * 60_000;
      return {
        key: new Date(t).toISOString(),
        t,
        ok: 0,
        rateLimited: 0,
        clientError: 0,
        serverError: i + 1,
        noResponse: 0,
        calls: i + 1,
        errors: i + 1,
        p50Ms: 1_000,
        p95Ms: 2_000,
      };
    });
    const dto: DiagnosticsDto = {
      ...INCIDENT_2026_09_25,
      llm: { state: "ok", data: { ...base.data, series: [{ provider: "SCCH", bins }] } },
    };
    const lines = formatDiagnosticsReport(dto, VIENNA).split("\n");
    expect(lines).toContain(
      `  Timeline (bins with errors or p95 ≥ 3× the range's p50, showing ${REPORT_TIMELINE_CAP} of 60)`,
    );
    const rows = lines.filter((l) => /^ {2}\d{2}:\d{2}Z /.test(l));
    expect(rows).toHaveLength(REPORT_TIMELINE_CAP);
    // The 12 lightest bins (05:00–05:11) are dropped; the rest stay chronological.
    expect(rows[0]).toMatch(/^ {2}05:12Z/);
    expect(rows.at(-1)).toMatch(/^ {2}05:59Z/);
  });

  it("reports unavailable and empty sections in one line each", () => {
    const dto: DiagnosticsDto = {
      ...INCIDENT_2026_09_25,
      telemetryMode: "otlp",
      llm: { state: "unavailable", failure: "forbidden" },
      impact: { state: "empty" },
    };
    const text = formatDiagnosticsReport(dto, VIENNA);
    expect(text).toContain("LLM calls: unavailable (forbidden)");
    expect(text).toContain("Student impact — no chat turns in this range.");
    expect(text).toContain("(mode: otlp)");
    expect(text).toContain("Note:      counts are estimates from sampled telemetry\n");

    const empty = formatDiagnosticsReport(
      { ...INCIDENT_2026_09_25, llm: { state: "empty" } },
      VIENNA,
    );
    expect(empty).toContain("No LLM calls in this range.");
  });

  it("says so when a provider had no errors", () => {
    const base = INCIDENT_2026_09_25.llm;
    if (base.state !== "ok") throw new Error("fixture");
    const dto: DiagnosticsDto = {
      ...INCIDENT_2026_09_25,
      llm: {
        state: "ok",
        data: {
          ...base.data,
          providers: base.data.providers.map((p) => ({
            ...p,
            errors: 0,
            failed: 0,
            errorRate: 0,
            p50Ms: 30_000,
          })),
        },
      },
    };
    const text = formatDiagnosticsReport(dto, VIENNA);
    expect(text).toContain("  No errors.");
    expect(text).not.toContain("Failed calls");
  });
});

describe("helpers", () => {
  it("formats durations", () => {
    expect(formatDurationMs(null)).toBe("—");
    expect(formatDurationMs(850.4)).toBe("850 ms");
    expect(formatDurationMs(15_122)).toBe("15.1 s");
    expect(formatDurationMs(72_000)).toBe("1 min 12 s");
  });

  it("formats percentages", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0.0824)).toBe("8.2 %");
  });

  it("labels UTC offsets", () => {
    const summer = new Date("2026-07-01T12:00:00Z");
    expect(utcOffsetLabel(summer, "Europe/Vienna")).toBe("UTC+2");
    expect(utcOffsetLabel(summer, "America/New_York")).toBe("UTC-4");
    expect(utcOffsetLabel(summer, "Asia/Kolkata")).toBe("UTC+5:30");
    expect(utcOffsetLabel(summer, "UTC")).toBe("UTC+0");
  });
});
