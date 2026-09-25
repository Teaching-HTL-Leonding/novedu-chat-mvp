import { LocalTime } from "@/app/local-time";
import { formatCount } from "@/components/charts/format";
import { type ListColumn, ListTable } from "@/components/data-list";
import { formatDurationMs } from "@/lib/diagnostics-report";
import type { ErrorBreakdownData, ErrorBreakdownRow, SectionState } from "@/lib/diagnostics-shape";
import { StateCard } from "./diagnostics-ui";

// Failed upstream calls by provider × HTTP status — capped in the query itself.

const seconds = (iso: string) => (iso ? Date.parse(iso) / 1000 : null);

export const statusText = (code: string) => (code === "" || code === "0" ? "no response" : code);

const columns: ListColumn<ErrorBreakdownRow>[] = [
  { header: "Provider", render: (r) => r.provider },
  { header: "Status", render: (r) => statusText(r.resultCode) },
  { header: "Calls (est.)", kind: "numeric", render: (r) => formatCount(r.count) },
  { header: "Median wait", kind: "numeric", render: (r) => formatDurationMs(r.medianMs) },
  {
    header: "First seen",
    kind: "time",
    render: (r) => <LocalTime seconds={seconds(r.firstSeen)} />,
  },
  { header: "Last seen", kind: "time", render: (r) => <LocalTime seconds={seconds(r.lastSeen)} /> },
];

export async function ErrorsSection({
  errors: errorsPromise,
}: {
  errors: Promise<SectionState<ErrorBreakdownData>>;
}) {
  const errors = await errorsPromise;
  return (
    <StateCard
      testId="diagnostics-errors"
      title="Errors by provider and status"
      subtitle={
        errors.state === "ok" && errors.data.capped
          ? `Showing the top ${errors.data.rows.length} groups by count.`
          : "Every non-2xx upstream call, grouped."
      }
      section={errors}
      empty="No failed LLM calls in this range."
    >
      {(data) => (
        <ListTable
          rows={data.rows}
          getRowKey={(r) => `${r.provider}:${r.resultCode}`}
          columns={columns}
        />
      )}
    </StateCard>
  );
}
