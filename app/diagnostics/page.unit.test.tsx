// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `app/diagnostics/page.tsx` is the teacher gate + shell. The gate must stop a
// non-teacher before any query starts; a bare URL must not query until the
// browser added its zone; an unconfigured server must show the card and never
// call Azure. Sections, client controls and the loader are stubbed.

const isEffectiveTeacher = vi.hoisted(() => vi.fn());
const loadDiagnostics = vi.hoisted(() => vi.fn());

vi.mock("@/lib/student-mode", () => ({ isEffectiveTeacher }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("./load", () => ({ loadDiagnostics }));
vi.mock("./range-controls", () => ({
  RangeControls: ({ active }: { active: string | null }) => (
    <div data-testid="range-controls" data-active={String(active)} />
  ),
}));
vi.mock("./ensure-range", () => ({ EnsureRange: () => <div data-testid="ensure-range" /> }));
vi.mock("./report-section", () => ({
  ReportSection: () => <div data-testid="report-section" />,
  ReportPending: () => null,
}));
vi.mock("./kpi-section", () => ({ KpiSection: () => <div data-testid="kpi-section" /> }));
vi.mock("./calls-section", () => ({ CallsSection: () => <div data-testid="calls-section" /> }));
vi.mock("./impact-section", () => ({ ImpactSection: () => <div data-testid="impact-section" /> }));
vi.mock("./errors-section", () => ({ ErrorsSection: () => <div data-testid="errors-section" /> }));
vi.mock("./failed-calls-section", () => ({
  FailedCallsSection: () => <div data-testid="failed-calls-section" />,
}));

import DiagnosticsPage from "./page";

const CONFIGURED = "InstrumentationKey=k;ApplicationId=app-1";

async function renderPage(params: Record<string, string>) {
  const element = await DiagnosticsPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", CONFIGURED);
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
  vi.stubEnv("OTEL_SDK_DISABLED", "");
  loadDiagnostics.mockReturnValue({
    llm: Promise.resolve({ state: "empty" }),
    errors: Promise.resolve({ state: "empty" }),
    failedCalls: Promise.resolve({ state: "empty" }),
    impact: Promise.resolve({ state: "empty" }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("denies a non-teacher without loading anything", async () => {
  isEffectiveTeacher.mockResolvedValue(false);
  const html = await renderPage({ range: "today", tz: "UTC" });
  expect(html).toContain("Access denied");
  expect(html).not.toContain("range-controls");
  expect(loadDiagnostics).not.toHaveBeenCalled();
});

describe("teacher", () => {
  beforeEach(() => {
    isEffectiveTeacher.mockResolvedValue(true);
  });

  it("asks the browser for its zone before querying", async () => {
    const html = await renderPage({});
    expect(html).toContain("ensure-range");
    expect(loadDiagnostics).not.toHaveBeenCalled();
  });

  it("shows the not-configured card and never queries without an ApplicationId", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=k");
    const html = await renderPage({ range: "today", tz: "UTC" });
    expect(html).toContain('data-testid="diagnostics-not-configured"');
    expect(html).not.toContain("kpi-section");
    expect(loadDiagnostics).not.toHaveBeenCalled();
  });

  it("loads once and renders every section for a preset", async () => {
    const html = await renderPage({ range: "last7d", tz: "Europe/Vienna" });
    expect(loadDiagnostics).toHaveBeenCalledTimes(1);
    for (const id of [
      "report-section",
      "kpi-section",
      "calls-section",
      "impact-section",
      "errors-section",
      "failed-calls-section",
    ]) {
      expect(html).toContain(id);
    }
    expect(html).toContain('data-active="last7d"');
    expect(html).not.toContain("diagnostics-telemetry-banner");
  });

  it("warns when this process sends its telemetry elsewhere", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const html = await renderPage({ range: "today", tz: "UTC" });
    expect(html).toContain("diagnostics-telemetry-banner");
    expect(html).toContain("otlp");
  });

  it("shows the fallback notice for an invalid custom range", async () => {
    const html = await renderPage({ from: "garbage", to: "2026-09-25T08:00:00Z" });
    expect(html).toContain("could not be read");
    expect(html).toContain('data-active="custom"');
    expect(loadDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback notice on an unconfigured server too", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=k");
    const html = await renderPage({ from: "2026-09-25T08:00:00Z", to: "2026-09-25T07:00:00Z" });
    expect(html).toContain("The custom range must start before it ends.");
    expect(html).toContain('data-testid="diagnostics-not-configured"');
    expect(loadDiagnostics).not.toHaveBeenCalled();
  });
});
