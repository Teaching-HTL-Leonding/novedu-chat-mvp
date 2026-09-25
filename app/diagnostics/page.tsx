import { headers } from "next/headers";
import { Suspense } from "react";
import { LocalTime } from "@/app/local-time";
import { ChartSkeleton, KpiSkeleton } from "@/components/dashboard-skeletons";
import { Main, PageBody } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { diagnosticsConfigured } from "@/lib/diagnostics-client";
import { parseDiagnosticsParams, type RangeParams } from "@/lib/diagnostics-range";
import { resolveTelemetryMode } from "@/lib/telemetry-mode";
import { CallsSection } from "./calls-section";
import { DelayHint, NotConfiguredCard, RangeNotice, TelemetryModeBanner } from "./diagnostics-ui";
import { EnsureRange } from "./ensure-range";
import { ErrorsSection } from "./errors-section";
import { FailedCallsSection } from "./failed-calls-section";
import { ImpactSection } from "./impact-section";
import { KpiSection } from "./kpi-section";
import { loadDiagnostics } from "./load";
import { RangeControls } from "./range-controls";
import { ReportPending, ReportSection } from "./report-section";

// Teacher-only LLM diagnostics (docs/diagnostics.md): how the upstream LLM calls
// behaved and what students experienced, read from the App Insights data the app
// already emits. Server-first like /usage — no API route. The page gate is the
// whole gate. The five queries start ONCE per render (`loadDiagnostics`) and each
// section streams behind its own Suspense boundary, keyed by the window, awaiting
// the shared promises; the Copy-report control waits for all of them.
export const dynamic = "force-dynamic";

/** The app's own public host, named in the report (never an upstream endpoint). */
async function serverName(): Promise<string> {
  const authUrl = process.env.AUTH_URL;
  if (authUrl) {
    try {
      return new URL(authUrl).hostname;
    } catch {
      // fall through to the request host
    }
  }
  return (await headers()).get("host") ?? "unknown";
}

export default async function DiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<RangeParams>;
}) {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const parse = parseDiagnosticsParams(await searchParams, new Date());
  const telemetry = resolveTelemetryMode();
  const banner = telemetry.mode !== "azure" ? <TelemetryModeBanner mode={telemetry.mode} /> : null;

  if (parse.kind === "needs-tz") {
    return (
      <Main>
        <PageBody className="gap-6">
          {banner}
          <RangeControls active={null} />
          <EnsureRange />
        </PageBody>
      </Main>
    );
  }

  const { range, notice } = parse;
  const active = range.source.kind === "preset" ? range.source.preset : "custom";
  const controls = (
    <RangeControls active={active} from={range.from.toISOString()} to={range.to.toISOString()} />
  );

  if (!diagnosticsConfigured()) {
    return (
      <Main>
        <PageBody className="gap-6">
          {banner}
          {controls}
          <NotConfiguredCard />
        </PageBody>
      </Main>
    );
  }

  const data = loadDiagnostics(range);
  const spanMs = range.to.getTime() - range.from.getTime();
  const meta = {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      bin: range.bin,
      ...(range.source.kind === "preset"
        ? { preset: range.source.preset, tz: range.source.tz }
        : {}),
    },
    generatedAt: new Date().toISOString(),
    server: await serverName(),
    telemetryMode: telemetry.mode,
  };
  const k = range.key;

  return (
    <Main>
      <PageBody className="gap-6">
        {banner}
        {controls}
        {notice ? <RangeNotice>{notice}</RangeNotice> : null}
        <p className="text-foreground/70 text-sm" data-testid="diagnostics-range">
          <LocalTime seconds={range.from.getTime() / 1000} /> –{" "}
          <LocalTime seconds={range.to.getTime() / 1000} />
        </p>
        <Suspense key={`report-${k}`} fallback={<ReportPending />}>
          <ReportSection meta={meta} {...data} />
        </Suspense>
        <Suspense key={`kpi-${k}`} fallback={<KpiSkeleton />}>
          <KpiSection llm={data.llm} impact={data.impact} />
        </Suspense>
        <Suspense key={`calls-${k}`} fallback={<ChartSkeleton title="Upstream LLM calls" />}>
          <CallsSection llm={data.llm} spanMs={spanMs} />
        </Suspense>
        <Suspense key={`impact-${k}`} fallback={<ChartSkeleton title="Student impact" />}>
          <ImpactSection impact={data.impact} spanMs={spanMs} />
        </Suspense>
        <Suspense
          key={`errors-${k}`}
          fallback={<ChartSkeleton title="Errors by provider and status" />}
        >
          <ErrorsSection errors={data.errors} />
        </Suspense>
        <Suspense key={`failed-${k}`} fallback={<ChartSkeleton title="Failed calls (sample)" />}>
          <FailedCallsSection failedCalls={data.failedCalls} llm={data.llm} />
        </Suspense>
        <DelayHint />
      </PageBody>
    </Main>
  );
}
