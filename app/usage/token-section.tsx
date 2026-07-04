import { type ListColumn, ListTable } from "@/components/data-list";
import type { TokenBucket, UsageRange } from "@/lib/usage-range";
import { getTokenTimeSeries } from "@/lib/usage-stats-store";
import { formatCount } from "./_charts/format";
import { DashboardCard, DataUnavailable } from "./dashboard-ui";
import { TokenUsageBarChart } from "./token-usage-bar-chart";

// The token-usage-over-time section: ONE `getTokenTimeSeries` read feeds both the
// (client) stacked bar chart and the (server) data table below it — read once,
// shown twice. Async server component behind its own Suspense boundary.

const total = (b: TokenBucket) => b.inputNew + b.inputCached + b.output;

const columns: ListColumn<TokenBucket>[] = [
  { header: "Time (UTC)", kind: "time", render: (b) => b.label },
  { header: "New input", kind: "numeric", render: (b) => formatCount(b.inputNew) },
  { header: "Cached input", kind: "numeric", render: (b) => formatCount(b.inputCached) },
  { header: "Output", kind: "numeric", render: (b) => formatCount(b.output) },
  { header: "Total", kind: "numeric", render: (b) => formatCount(total(b)) },
];

export async function TokenSection({ range, now }: { range: UsageRange; now: Date }) {
  const data = await getTokenTimeSeries({ range, now });
  return (
    <DashboardCard
      title="Token usage over time"
      subtitle="Cached input, new input, and output tokens per bucket (UTC)."
    >
      {data ? (
        <>
          <TokenUsageBarChart data={data} />
          <div className="mt-4 max-h-80 overflow-y-auto">
            <ListTable rows={data} getRowKey={(b) => b.key} columns={columns} />
          </div>
        </>
      ) : (
        <DataUnavailable />
      )}
    </DashboardCard>
  );
}
