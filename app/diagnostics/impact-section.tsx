import { formatCount } from "@/components/charts/format";
import { type ListColumn, ListTable } from "@/components/data-list";
import type { FailureGroup, SectionState, StudentImpact } from "@/lib/diagnostics-shape";
import { StudentImpactChart } from "./_charts/student-impact-chart";
import { StateCard } from "./diagnostics-ui";

// What students experienced: failed chat turns and the p95 of a full turn over
// time, plus the failures grouped by module and error code.

const columns: ListColumn<FailureGroup>[] = [
  { header: "Module", render: (g) => g.module },
  { header: "Failure", render: (g) => <code>{g.label}</code> },
  { header: "Turns (est.)", kind: "numeric", render: (g) => formatCount(g.count) },
];

export async function ImpactSection({
  impact: impactPromise,
  spanMs,
}: {
  impact: Promise<SectionState<StudentImpact>>;
  spanMs: number;
}) {
  const impact = await impactPromise;
  return (
    <StateCard
      testId="diagnostics-impact"
      title="Student impact"
      subtitle="Failed chat turns per bin (bars) and the p95 of a full chat turn (line)."
      section={impact}
      empty="No chat turns in this range."
    >
      {(data) => (
        <>
          <StudentImpactChart bins={data.bins} spanMs={spanMs} />
          {data.groups.length > 0 ? (
            <div className="mt-4">
              <ListTable
                rows={data.groups}
                getRowKey={(g) => `${g.module}:${g.label}`}
                columns={columns}
              />
            </div>
          ) : null}
        </>
      )}
    </StateCard>
  );
}
