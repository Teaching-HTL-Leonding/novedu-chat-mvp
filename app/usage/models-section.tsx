import type { UsageRange } from "@/lib/usage-range";
import { getTokensByModel, getTokensByProvider } from "@/lib/usage-stats-store";
import { DashboardCard, DataUnavailable, EmptyRange } from "./dashboard-ui";
import { TokensPieChart } from "./tokens-pie-chart";

// The two LLM-attribution pies: tokens by model and tokens by provider. They are
// separate reads (two `GROUP BY`s over the same window) issued in parallel, so a
// slow or failed one degrades only its own card. The provider pie is the cost
// split — model ids are NOT provider-disjoint, so the model pie cannot stand in
// for it. Async server component behind its own Suspense boundary; the two cards
// fill the same half-width grid as the breakdown pies above.
//
// Both use the pie's rank-colored `variant="model"`: providers have no fixed
// identity order to color by (unlike the modules), so the rank palette + "Other"
// gray is exactly the assignment they need.

export async function ModelsSection({ range, now }: { range: UsageRange; now: Date }) {
  const [models, providers] = await Promise.all([
    getTokensByModel({ range, now }),
    getTokensByProvider({ range, now }),
  ]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DashboardCard title="Tokens by model" subtitle="Top 9 models + Other (UTC window).">
        {!models ? (
          <DataUnavailable />
        ) : models.length > 0 ? (
          <TokensPieChart slices={models} variant="model" />
        ) : (
          <EmptyRange>No usage in this range.</EmptyRange>
        )}
      </DashboardCard>
      <DashboardCard
        title="Tokens by provider"
        subtitle="Total tokens per LLM provider recorded with the usage (UTC window)."
      >
        {!providers ? (
          <DataUnavailable />
        ) : providers.length > 0 ? (
          <TokensPieChart slices={providers} variant="model" />
        ) : (
          <EmptyRange>No usage in this range.</EmptyRange>
        )}
      </DashboardCard>
    </div>
  );
}
