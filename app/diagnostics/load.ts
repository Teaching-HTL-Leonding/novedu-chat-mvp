import { runDiagnosticsQuery } from "@/lib/diagnostics-client";
import { providerHostMap } from "@/lib/diagnostics-hosts";
import { buildDiagnosticsQueries, type DiagnosticsQueryName } from "@/lib/diagnostics-kql";
import type { ResolvedRange } from "@/lib/diagnostics-range";
import {
  type ErrorBreakdownData,
  type FailedCallsData,
  type LlmData,
  type SectionState,
  type StudentImpact,
  shapeErrorBreakdown,
  shapeFailedCalls,
  shapeImpact,
  shapeLlm,
} from "@/lib/diagnostics-shape";

// The diagnostics page's data, loaded ONCE per render: the five App Insights
// queries start together and each resolves to its shaped section. The page hands
// these promises to its Suspense sections, so a section that needs two of them
// (the KPIs, the report) awaits the same promise as its neighbours — no query ever
// runs twice. Every promise resolves (the client never throws). docs/diagnostics.md
//
// SERVER-ONLY.

export interface DiagnosticsPromises {
  llm: Promise<SectionState<LlmData>>;
  errors: Promise<SectionState<ErrorBreakdownData>>;
  failedCalls: Promise<SectionState<FailedCallsData>>;
  impact: Promise<SectionState<StudentImpact>>;
}

export function loadDiagnostics(range: ResolvedRange): DiagnosticsPromises {
  const window = { from: range.from, to: range.to, bin: range.bin };
  const queries = buildDiagnosticsQueries(window);
  const hosts = providerHostMap();
  const run = (name: DiagnosticsQueryName) => runDiagnosticsQuery(name, queries[name], window);

  const failures = run("chatFailures");
  const turns = run("chatTurns");
  return {
    llm: run("llmCalls").then((r) => shapeLlm(r, range, hosts)),
    errors: run("llmErrorBreakdown").then((r) => shapeErrorBreakdown(r, hosts)),
    failedCalls: run("llmFailedSample").then((r) => shapeFailedCalls(r, hosts)),
    impact: Promise.all([failures, turns]).then(([f, t]) => shapeImpact(f, t, range)),
  };
}
