import { DataUnavailable } from "@/components/dashboard-ui";
import { addDays, type LocalDate } from "@/lib/achievements/time";
import { type AttentionList, getTeacherHome } from "@/lib/home-data";
import { cn } from "@/lib/utils";
import { AttentionBar, type AttentionCounter, type AttentionRow } from "./attention-bar";
import { dayLabel, HOME_CARD, HOME_CARD_PAD, shortDayLabel } from "./home-ui";

// "Needs you": the three attention counters of the teacher start page — codes
// closing soon, open reports, codes never used — over the teacher's OWN codes.
// A counter with nothing in it reads "all clear"; one whose fact group failed
// says so. The first counter with something in it starts open.

function closesText(on: LocalDate, at: string, today: LocalDate): string {
  if (on === today) return `Closes today ${at}`;
  if (on === addDays(today, 1)) return `Closes tomorrow ${at}`;
  return `Closes ${dayLabel(on)} ${at}`;
}

function counter<T>(
  id: AttentionCounter["id"],
  list: AttentionList<T> | undefined,
  row: (item: T) => AttentionRow,
): AttentionCounter {
  if (!list) return { id, unavailable: true };
  return { id, total: list.total, rows: list.items.map(row), more: list.more };
}

export async function AttentionSection({ userId }: { userId: string }) {
  const home = await getTeacherHome(userId);
  if (home.hasCodes === false) return null;
  if (home.hasCodes === undefined) {
    return (
      <section aria-labelledby="home-attention" className={cn(HOME_CARD, HOME_CARD_PAD)}>
        <h2 id="home-attention" className="font-semibold text-sm">
          Needs you
        </h2>
        <DataUnavailable />
      </section>
    );
  }
  const { today } = home;
  const counters = [
    counter("closing", home.closingSoon, (item) => ({
      code: item.code,
      label: item.label,
      detail: closesText(item.closesOn, item.closesAt, today),
      urgent: item.closesOn === today,
    })),
    counter("reports", home.openReports, (item) => ({
      code: item.code,
      label: item.label,
      badge: `${item.open.toLocaleString("en")} open`,
    })),
    counter("unused", home.neverUsed, (item) => ({
      code: item.code,
      label: item.label,
      detail: `Created ${shortDayLabel(item.createdOn)}`,
    })),
  ];
  return <AttentionBar counters={counters} />;
}

export function AttentionSkeleton() {
  return <div className={cn(HOME_CARD, "h-16")} aria-hidden="true" />;
}
