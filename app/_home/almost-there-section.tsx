import { DataUnavailable } from "@/components/dashboard-ui";
import { getStudentHome } from "@/lib/home-data";
import { cn } from "@/lib/utils";
import { BadgeDisc, FAMILY_BG } from "./badge-disc";
import { HOME_CAPTION, HOME_CARD, HOME_CARD_PAD, HOME_MUTED, HOME_SECTION_TITLE } from "./home-ui";
import { Meter } from "./meter";

// Almost there: the listed badges closest to being earned (at most four). Sits
// beside "Time to refresh" from lg up (app/page.tsx).

export async function AlmostThereSection({ userId }: { userId: string }) {
  const { almostThere } = await getStudentHome(userId);
  let body: React.ReactNode;
  if (!almostThere) {
    body = <DataUnavailable />;
  } else if (almostThere.length === 0) {
    body = <p className={HOME_MUTED}>Badges you're close to will show up here.</p>;
  } else {
    body = (
      // Two columns while the card has the band to itself (below lg); one beside "Time to refresh".
      <ul className="grid gap-x-8 md:grid-cols-2 lg:grid-cols-1">
        {almostThere.map((badge) => {
          const current = badge.current ?? 0;
          const target = badge.target ?? 1;
          return (
            <li key={badge.id} className="flex items-center gap-3 py-2">
              <BadgeDisc icon={badge.icon} family={badge.family} locked />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex justify-between gap-2 text-sm">
                  <b className="font-semibold">{badge.name}</b>
                  <span className="text-foreground/65 tabular-nums">
                    {current.toLocaleString("en")} / {target.toLocaleString("en")}
                  </span>
                </div>
                <Meter
                  value={current / target}
                  fillClassName={FAMILY_BG[badge.family] ?? "bg-foreground"}
                  className="h-1.5"
                  aria-hidden="true"
                />
                <div className={HOME_CAPTION}>
                  {badge.criterion} · <span className="whitespace-nowrap">+{badge.xp} XP</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <section aria-labelledby="home-almost" className={cn(HOME_CARD, HOME_CARD_PAD)}>
      <h2 id="home-almost" className={cn(HOME_SECTION_TITLE, "mb-2")}>
        Almost there
      </h2>
      {body}
    </section>
  );
}

export function AlmostThereSkeleton() {
  return <div className={cn(HOME_CARD, "h-40")} aria-hidden="true" />;
}
