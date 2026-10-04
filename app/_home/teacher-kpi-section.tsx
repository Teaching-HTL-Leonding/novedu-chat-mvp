import { formatCompact, formatCount } from "@/components/charts/format";
import { StatTile } from "@/components/ui/stat-tile";
import { getTeacherHome, type TeacherKpis } from "@/lib/home-data";
import { cn } from "@/lib/utils";
import { HOME_CAPTION, HOME_SECTION_HEAD, HOME_SECTION_TITLE } from "./home-ui";

// The teacher start page's six KPIs over the last 30 days, the teacher's OWN
// codes only. A KPI whose fact group failed says "Unavailable" — never 0.

const TILES: { key: keyof TeacherKpis; label: string; compact?: boolean; note?: boolean }[] = [
  { key: "liveCodes", label: "Live codes" },
  { key: "students", label: "Identified students", note: true },
  { key: "conversations", label: "Conversations" },
  { key: "quizAnswers", label: "Quiz answers" },
  { key: "inputTokens", label: "Input tokens", compact: true },
  { key: "outputTokens", label: "Output tokens", compact: true },
];

export async function TeacherKpiSection({ userId }: { userId: string }) {
  const { hasCodes, kpis } = await getTeacherHome(userId);
  if (hasCodes === false) return null;
  return (
    <section aria-labelledby="home-kpis">
      <div className={cn(HOME_SECTION_HEAD, "mb-3")}>
        <h2 id="home-kpis" className={HOME_SECTION_TITLE}>
          Last 30 days
        </h2>
        <span className={HOME_CAPTION}>Your activities only</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {TILES.map((tile) => {
          const value = kpis[tile.key];
          return (
            <StatTile
              key={tile.key}
              className="min-w-0"
              label={tile.label}
              value={
                value === undefined ? (
                  <span className="font-medium text-base text-foreground/60">Unavailable</span>
                ) : (
                  <span className="tabular-nums">
                    {tile.compact ? formatCompact(value) : formatCount(value)}
                    {tile.note ? (
                      <sup
                        aria-hidden="true"
                        className="ml-0.5 font-semibold text-foreground/60 text-sm"
                      >
                        *
                      </sup>
                    ) : null}
                  </span>
                )
              }
            />
          );
        })}
      </dl>
      <p className={cn(HOME_CAPTION, "mt-2.5")}>
        * Identified students counts everyone in your per-user and coding activities, ever. Students
        in anonymous activities can't be counted.
      </p>
    </section>
  );
}

export function TeacherKpiSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-3 h-6" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {TILES.map((tile) => (
          <div key={tile.key} className="h-[74px] rounded-lg border border-foreground/15 bg-card" />
        ))}
      </div>
    </div>
  );
}
