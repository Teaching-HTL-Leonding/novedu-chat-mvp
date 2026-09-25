import { formatCount } from "@/components/charts/format";
import { StatTile } from "@/components/ui/stat-tile";
import { formatDurationMs, formatPercent } from "@/lib/diagnostics-report";
import type { LlmData, SectionState, StudentImpact } from "@/lib/diagnostics-shape";
import { type CardState, SectionCard, Unavailable } from "./diagnostics-ui";

// Headline numbers for the whole range: one tile row per provider with calls, one
// for student impact, and the sampling note. Awaits the same two promises the
// charts below use (app/diagnostics/load.ts).

function combinedState(a: SectionState<unknown>, b: SectionState<unknown>): CardState {
  if (a.state === "unavailable" || b.state === "unavailable") return "unavailable";
  if (a.state === "ok" || b.state === "ok") return "ok";
  return "empty";
}

export async function KpiSection({
  llm: llmPromise,
  impact: impactPromise,
}: {
  llm: Promise<SectionState<LlmData>>;
  impact: Promise<SectionState<StudentImpact>>;
}) {
  const [llm, impact] = await Promise.all([llmPromise, impactPromise]);
  const failure =
    llm.state === "unavailable"
      ? llm.failure
      : impact.state === "unavailable"
        ? impact.failure
        : undefined;
  return (
    <SectionCard
      testId="diagnostics-kpis"
      title="Summary"
      subtitle="Whole range. Error rate = 5xx, 429 and calls without a response."
      state={combinedState(llm, impact)}
      failure={failure}
    >
      <div className="flex flex-col gap-4">
        {llm.state === "unavailable" ? <Unavailable failure={llm.failure} /> : null}
        {llm.state === "empty" ? (
          <p className="text-foreground/60 text-sm">No LLM calls in this range.</p>
        ) : null}
        {llm.state === "ok"
          ? llm.data.providers.map((p) => (
              <div key={p.provider} className="flex flex-col gap-2">
                <h3 className="font-semibold text-sm">{p.provider}</h3>
                <dl className="flex flex-wrap gap-3">
                  <StatTile
                    className="flex-1"
                    label="LLM calls (est.)"
                    value={formatCount(p.calls)}
                  />
                  <StatTile
                    className="flex-1"
                    label="Error rate"
                    value={formatPercent(p.errorRate)}
                  />
                  <StatTile
                    className="flex-1"
                    label="Header wait p50"
                    value={formatDurationMs(p.p50Ms)}
                  />
                  <StatTile
                    className="flex-1"
                    label="Header wait p95"
                    value={formatDurationMs(p.p95Ms)}
                  />
                  <StatTile
                    className="flex-1"
                    label="Header wait max"
                    value={formatDurationMs(p.maxMs)}
                  />
                </dl>
              </div>
            ))
          : null}

        <div className="flex flex-col gap-2">
          <h3 className="font-semibold text-sm">Student impact</h3>
          {impact.state === "unavailable" ? <Unavailable failure={impact.failure} /> : null}
          {impact.state === "empty" ? (
            <p className="text-foreground/60 text-sm">No chat turns in this range.</p>
          ) : null}
          {impact.state === "ok" ? (
            <dl className="flex flex-wrap gap-3">
              <StatTile
                className="flex-1"
                label="Failed chat turns"
                value={formatCount(impact.data.failedTurns)}
              />
              <StatTile
                className="flex-1"
                label="Share of turns"
                value={formatPercent(impact.data.failedShare)}
              />
              <StatTile
                className="flex-1"
                label="Chat turn p95"
                value={formatDurationMs(impact.data.turnP95Ms)}
              />
            </dl>
          ) : null}
        </div>

        {llm.state === "ok" && llm.data.sampling.ratio !== null ? (
          <p className="text-foreground/60 text-xs" data-testid="diagnostics-sampling">
            Counts are estimates: ≈ {Math.round(llm.data.sampling.ratio * 100)} % of telemetry rows
            are retained ({formatCount(llm.data.sampling.rows)} rows for ≈{" "}
            {formatCount(llm.data.sampling.estimated)} calls).
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
