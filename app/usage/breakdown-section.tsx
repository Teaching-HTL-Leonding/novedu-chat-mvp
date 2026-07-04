import { type CodeModule, codeModuleLabels } from "@/lib/code-modules/types";
import type { Slice, UsageRange } from "@/lib/usage-range";
import { getUsageBreakdown } from "@/lib/usage-stats-store";
import { DashboardCard, DataUnavailable, EmptyRange } from "./dashboard-ui";
import { TokensPieChart } from "./tokens-pie-chart";

// The two breakdown pies. ONE `getUsageBreakdown` read feeds both — summed by
// module and folded top-9-by-code + Other — read once, shown twice. Async server
// component behind its own Suspense boundary.

// Map the raw module id (the store's slice label) to its display badge, keeping the
// key so the pie can still color by module identity.
const withModuleLabels = (slices: Slice[]): Slice[] =>
  slices.map((s) => ({ ...s, label: codeModuleLabels[s.key as CodeModule]?.badge ?? s.label }));

export async function BreakdownSection({ range, now }: { range: UsageRange; now: Date }) {
  const breakdown = await getUsageBreakdown({ range, now });
  if (!breakdown) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <DashboardCard title="Tokens by category">
          <DataUnavailable />
        </DashboardCard>
        <DashboardCard title="Tokens by code">
          <DataUnavailable />
        </DashboardCard>
      </div>
    );
  }
  const modules = withModuleLabels(breakdown.byModule);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DashboardCard title="Tokens by category" subtitle="Total tokens per module (UTC window).">
        {modules.length > 0 ? (
          <TokensPieChart slices={modules} variant="module" />
        ) : (
          <EmptyRange>No usage in this range.</EmptyRange>
        )}
      </DashboardCard>
      <DashboardCard title="Tokens by code" subtitle="Top 9 codes + Other (UTC window).">
        {breakdown.byCode.length > 0 ? (
          <TokensPieChart slices={breakdown.byCode} variant="code" />
        ) : (
          <EmptyRange>No usage in this range.</EmptyRange>
        )}
      </DashboardCard>
    </div>
  );
}
