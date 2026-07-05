import type { UsageRange } from "@/lib/usage-range";
import { getTokensByModel } from "@/lib/usage-stats-store";
import { DashboardCard, DataUnavailable, EmptyRange } from "./dashboard-ui";
import { TokensPieChart } from "./tokens-pie-chart";

// The tokens-by-model pie. Model ids are provider-specific (SCCH ids vs. Foundry
// deployment names), so this panel doubles as the paid-Foundry vs. free-SCCH cost
// split without a dedicated per-provider chart. Async server component behind its
// own Suspense boundary; half-width to line up with the breakdown pies above it.

export async function ModelsSection({ range, now }: { range: UsageRange; now: Date }) {
  const slices = await getTokensByModel({ range, now });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DashboardCard
        title="Tokens by model"
        subtitle="Top 9 models + Other (UTC window). Models are provider-specific, so this is also the SCCH vs. Azure Foundry split."
      >
        {!slices ? (
          <DataUnavailable />
        ) : slices.length > 0 ? (
          <TokensPieChart slices={slices} variant="model" />
        ) : (
          <EmptyRange>No usage in this range.</EmptyRange>
        )}
      </DashboardCard>
    </div>
  );
}
