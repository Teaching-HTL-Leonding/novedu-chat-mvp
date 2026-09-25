import { Button } from "@/components/ui/button";
import type {
  DiagnosticsDto,
  ErrorBreakdownData,
  FailedCallsData,
  LlmData,
  SectionState,
  StudentImpact,
} from "@/lib/diagnostics-shape";
import { CopyReportButton } from "./copy-report-button";

// The "Copy report" control. It has its own Suspense boundary that awaits ALL
// sections, so the button only becomes usable once the page has settled — and the
// report it copies is assembled from exactly the data on screen.

export type ReportMeta = Omit<DiagnosticsDto, "llm" | "errors" | "failedCalls" | "impact">;

export async function ReportSection({
  meta,
  llm,
  errors,
  failedCalls,
  impact,
}: {
  meta: ReportMeta;
  llm: Promise<SectionState<LlmData>>;
  errors: Promise<SectionState<ErrorBreakdownData>>;
  failedCalls: Promise<SectionState<FailedCallsData>>;
  impact: Promise<SectionState<StudentImpact>>;
}) {
  const [l, e, f, i] = await Promise.all([llm, errors, failedCalls, impact]);
  return <CopyReportButton dto={{ ...meta, llm: l, errors: e, failedCalls: f, impact: i }} />;
}

export function ReportPending() {
  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" disabled>
        Copy report
      </Button>
      <span className="text-foreground/60 text-xs" role="status">
        Waiting for all sections…
      </span>
    </div>
  );
}
