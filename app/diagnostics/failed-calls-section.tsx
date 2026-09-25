import { LocalTime } from "@/app/local-time";
import { formatCount } from "@/components/charts/format";
import { type ListColumn, ListTable } from "@/components/data-list";
import { formatDurationMs } from "@/lib/diagnostics-report";
import type {
  FailedCallRow,
  FailedCallsData,
  LlmData,
  SectionState,
} from "@/lib/diagnostics-shape";
import { StateCard } from "./diagnostics-ui";
import { statusText } from "./errors-section";

// The newest failed upstream calls — a SAMPLE of the retained telemetry rows,
// each standing for `itemCount` calls. Capped in the query itself.

const columns: ListColumn<FailedCallRow>[] = [
  {
    header: "Time",
    kind: "time",
    render: (r) => <LocalTime seconds={r.time ? Date.parse(r.time) / 1000 : null} />,
  },
  { header: "Provider", render: (r) => r.provider },
  { header: "Status", render: (r) => statusText(r.resultCode) },
  { header: "Header wait", kind: "numeric", render: (r) => formatDurationMs(r.durationMs) },
  { header: "Stands for", kind: "numeric", render: (r) => formatCount(r.itemCount) },
];

export async function FailedCallsSection({
  failedCalls: failedPromise,
  llm: llmPromise,
}: {
  failedCalls: Promise<SectionState<FailedCallsData>>;
  llm: Promise<SectionState<LlmData>>;
}) {
  const [failed, llm] = await Promise.all([failedPromise, llmPromise]);
  const total = llm.state === "ok" ? llm.data.totalFailed : undefined;
  const subtitle =
    failed.state === "ok"
      ? `A sample, newest first: showing ${failed.data.rows.length} rows${
          total !== undefined ? ` of ≈ ${formatCount(total)} failed calls` : ""
        }.`
      : "A sample of the retained telemetry rows, newest first.";
  return (
    <StateCard
      testId="diagnostics-failed-calls"
      title="Failed calls (sample)"
      subtitle={subtitle}
      section={failed}
      empty="No failed LLM calls in this range."
    >
      {(data) => (
        <div className="max-h-96 overflow-y-auto">
          <ListTable
            rows={data.rows}
            getRowKey={(r) =>
              `${data.rows.indexOf(r)}:${r.time}:${r.provider}:${r.resultCode}:${r.durationMs}`
            }
            columns={columns}
          />
        </div>
      )}
    </StateCard>
  );
}
