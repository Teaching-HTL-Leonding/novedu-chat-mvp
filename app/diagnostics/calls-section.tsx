import type { LlmData, SectionState } from "@/lib/diagnostics-shape";
import { CallsByOutcomeChart } from "./_charts/calls-by-outcome-chart";
import { WaitPercentilesChart } from "./_charts/wait-percentiles-chart";
import { StateCard } from "./diagnostics-ui";

// Upstream calls over time (stacked by outcome, one small chart per provider, SCCH
// first) and the header-wait percentiles — both from the ONE llmCalls query.

export async function CallsSection({
  llm: llmPromise,
  spanMs,
}: {
  llm: Promise<SectionState<LlmData>>;
  spanMs: number;
}) {
  const llm = await llmPromise;
  return (
    <>
      <StateCard
        testId="diagnostics-calls"
        title="Upstream LLM calls"
        subtitle="Estimated calls per bin by HTTP outcome, per provider."
        section={llm}
        empty="No LLM calls in this range."
      >
        {(data) => (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.series.map((s) => (
              <div key={s.provider}>
                <h3 className="mb-1 font-semibold text-sm">{s.provider}</h3>
                <CallsByOutcomeChart bins={s.bins} spanMs={spanMs} />
              </div>
            ))}
          </div>
        )}
      </StateCard>
      <StateCard
        testId="diagnostics-wait"
        title="Wait for response headers"
        subtitle="p50 (solid) and p95 (dashed) per bin — the time before the answer starts streaming."
        section={llm}
        empty="No LLM calls in this range."
      >
        {(data) => <WaitPercentilesChart series={data.series} spanMs={spanMs} />}
      </StateCard>
    </>
  );
}
