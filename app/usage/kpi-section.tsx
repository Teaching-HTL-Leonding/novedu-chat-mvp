import { StatTile } from "@/components/ui/stat-tile";
import type { UsageRange } from "@/lib/usage-range";
import { getDashboardKpis } from "@/lib/usage-stats-store";
import { formatCount } from "./_charts/format";
import { DataUnavailable } from "./dashboard-ui";

// Headline KPIs — both windowed to the selected range. Async server component:
// one query, rendered behind its own Suspense boundary so it streams independently.
export async function KpiSection({ range, now }: { range: UsageRange; now: Date }) {
  const kpis = await getDashboardKpis({ range, now });
  if (!kpis) return <DataUnavailable />;
  return (
    <dl className="flex flex-wrap gap-4">
      <StatTile
        data-testid="usage-kpi-chats"
        className="flex-1"
        label="Chats"
        value={formatCount(kpis.chats)}
      />
      <StatTile
        data-testid="usage-kpi-quiz"
        className="flex-1"
        label="Quiz answers graded"
        value={formatCount(kpis.quizAnswers)}
      />
    </dl>
  );
}
