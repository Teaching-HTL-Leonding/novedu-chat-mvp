// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { INCIDENT_2026_09_25 } from "@/lib/diagnostics-report.fixture";
import type { SectionState } from "@/lib/diagnostics-shape";

// The async section components: each renders its data, the empty copy, or the
// unavailable copy for its failure — and exposes that state through `data-state` /
// `data-failure`, which the e2e specs wait on. Client charts and the copy button
// are stubbed so this stays a hermetic node render.

const copyButton = vi.hoisted(() => vi.fn());

vi.mock("./_charts/calls-by-outcome-chart", () => ({
  CallsByOutcomeChart: () => <div data-testid="calls-chart" />,
}));
vi.mock("./_charts/wait-percentiles-chart", () => ({
  WaitPercentilesChart: () => <div data-testid="wait-chart" />,
}));
vi.mock("./_charts/student-impact-chart", () => ({
  StudentImpactChart: () => <div data-testid="impact-chart" />,
}));
vi.mock("./copy-report-button", () => ({
  CopyReportButton: (props: unknown) => {
    copyButton(props);
    return <div data-testid="copy-button" />;
  },
}));

import { CallsSection } from "./calls-section";
import { ErrorsSection } from "./errors-section";
import { FailedCallsSection } from "./failed-calls-section";
import { ImpactSection } from "./impact-section";
import { KpiSection } from "./kpi-section";
import { ReportSection } from "./report-section";

const dto = INCIDENT_2026_09_25;
const p = <T,>(s: SectionState<T>) => Promise.resolve(s);
const SPAN = 4 * 3_600_000;

describe("KpiSection", () => {
  it("renders provider and student-impact tiles", async () => {
    const html = renderToStaticMarkup(await KpiSection({ llm: p(dto.llm), impact: p(dto.impact) }));
    expect(html).toContain('data-state="ok"');
    expect(html).toContain("SCCH");
    expect(html).toContain("102"); // calls
    expect(html).toContain("9.8 %"); // error rate
    expect(html).toContain("25.3 s"); // p95
    expect(html).toContain("11.8 %"); // failed share
    expect(html).toContain("≈ 43 %");
  });

  it("is unavailable when either half failed", async () => {
    const html = renderToStaticMarkup(
      await KpiSection({
        llm: p({ state: "unavailable", failure: "forbidden" }),
        impact: p(dto.impact),
      }),
    );
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain('data-failure="forbidden"');
    expect(html).toContain("missing Reader role?");
  });
});

describe("CallsSection", () => {
  it("renders one outcome chart per provider plus the wait chart", async () => {
    const html = renderToStaticMarkup(await CallsSection({ llm: p(dto.llm), spanMs: SPAN }));
    expect(html).toContain('data-testid="diagnostics-calls"');
    expect(html.match(/data-testid="calls-chart"/g)).toHaveLength(1);
    expect(html).toContain("wait-chart");
  });

  it("shows the empty copy", async () => {
    const html = renderToStaticMarkup(
      await CallsSection({ llm: p({ state: "empty" }), spanMs: SPAN }),
    );
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No LLM calls in this range.");
    expect(html).not.toContain("calls-chart");
  });

  it("shows the timeout copy", async () => {
    const html = renderToStaticMarkup(
      await CallsSection({ llm: p({ state: "unavailable", failure: "timeout" }), spanMs: SPAN }),
    );
    expect(html).toContain('data-failure="timeout"');
    expect(html).toContain("try a shorter range");
  });
});

describe("ImpactSection", () => {
  it("renders the chart and the failure groups", async () => {
    const html = renderToStaticMarkup(await ImpactSection({ impact: p(dto.impact), spanMs: SPAN }));
    expect(html).toContain("impact-chart");
    expect(html).toContain("INCOMPLETE_STREAM");
    expect(html).toContain("tutor");
  });
});

describe("ErrorsSection", () => {
  it("renders the breakdown and says when it is capped", async () => {
    if (dto.errors.state !== "ok") throw new Error("fixture");
    const html = renderToStaticMarkup(await ErrorsSection({ errors: p(dto.errors) }));
    expect(html).toContain("503");
    expect(html).toContain("15.1 s");
    const capped = renderToStaticMarkup(
      await ErrorsSection({
        errors: p({ state: "ok", data: { ...dto.errors.data, capped: true } }),
      }),
    );
    expect(capped).toContain("Showing the top 1 groups by count.");
  });

  it("shows the generic unavailable copy", async () => {
    const html = renderToStaticMarkup(
      await ErrorsSection({ errors: p({ state: "unavailable", failure: "error" }) }),
    );
    expect(html).toContain("could not be loaded right now");
  });
});

describe("FailedCallsSection", () => {
  it("labels the table as a sample of the total", async () => {
    const html = renderToStaticMarkup(
      await FailedCallsSection({ failedCalls: p(dto.failedCalls), llm: p(dto.llm) }),
    );
    expect(html).toContain("showing 5 rows of ≈ 10 failed calls");
    expect(html).toContain("503");
  });
});

describe("ReportSection", () => {
  it("hands the assembled DTO to the copy button", async () => {
    const { llm, errors, failedCalls, impact, ...meta } = dto;
    renderToStaticMarkup(
      await ReportSection({
        meta,
        llm: p(llm),
        errors: p(errors),
        failedCalls: p(failedCalls),
        impact: p(impact),
      }),
    );
    expect(copyButton).toHaveBeenCalledWith({ dto });
  });
});
