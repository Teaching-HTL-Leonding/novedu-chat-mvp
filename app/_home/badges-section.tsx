import { DataUnavailable } from "@/components/dashboard-ui";
import { buttonVariants } from "@/components/ui/button";
import { META_LABEL } from "@/components/ui/meta-label";
import type { BadgeItem } from "@/lib/home-data";
import { getStudentHome } from "@/lib/home-data";
import { cn } from "@/lib/utils";
import { BadgeDisc } from "./badge-disc";
import { Disclosure } from "./disclosure";
import {
  HOME_CAPTION,
  HOME_CARD,
  HOME_CARD_PAD,
  HOME_MUTED,
  HOME_SECTION_HEAD,
  HOME_SECTION_TITLE,
  shortDayLabel,
} from "./home-ui";

// Badges, family by family: what you earned plus the next tier of each ladder;
// "Show all badges" reveals the rest. Hidden badges are never in the data until
// earned (lib/home-data.ts), so nothing here can leak one.

export async function BadgesSection({ userId }: { userId: string }) {
  const { badges } = await getStudentHome(userId);
  if (!badges) {
    return (
      <section aria-labelledby="home-badges" className={cn(HOME_CARD, HOME_CARD_PAD)}>
        <h2 id="home-badges" className={HOME_SECTION_TITLE}>
          Badges
        </h2>
        <DataUnavailable />
      </section>
    );
  }
  const more = badges.families.reduce((n, f) => n + f.more.length, 0);
  const families = (
    <div id="home-badge-families" className="grid gap-x-7 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
      {badges.families.map((family) => (
        <div key={family.id}>
          <h3 className={cn(META_LABEL, "mb-2")}>{family.label}</h3>
          <ul>
            {family.shown.map((badge) => (
              <BadgeRow key={badge.id} badge={badge} />
            ))}
            {family.more.map((badge) => (
              <BadgeRow key={badge.id} badge={badge} extra />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
  return (
    <section aria-labelledby="home-badges" className={cn(HOME_CARD, HOME_CARD_PAD)}>
      <div className={HOME_SECTION_HEAD}>
        <h2 id="home-badges" className={HOME_SECTION_TITLE}>
          Badges
        </h2>
        <span className={HOME_MUTED}>{badges.earned} earned</span>
      </div>
      {more > 0 ? (
        <Disclosure
          label={`Show all badges (${more} more)`}
          expandedLabel="Show fewer badges"
          controls="home-badge-families"
          buttonClassName={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}
          className="flex flex-col items-start"
        >
          {families}
        </Disclosure>
      ) : (
        families
      )}
    </section>
  );
}

function BadgeRow({ badge, extra = false }: { badge: BadgeItem; extra?: boolean }) {
  return (
    <li
      data-badge={badge.id}
      className={cn(
        "flex items-center gap-2.5 py-1.5",
        extra && "hidden group-data-[expanded=true]/disclosure:flex",
      )}
    >
      <BadgeDisc
        icon={badge.icon}
        family={badge.family}
        locked={!badge.earned}
        isNew={badge.isNew}
        size="sm"
      />
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm leading-tight",
            badge.earned ? "font-medium" : "text-foreground/70",
          )}
        >
          {badge.name}
          {badge.isNew ? (
            <span className="ml-1.5 inline-block rounded-full bg-amber-wash px-1.5 font-semibold text-amber-ink text-xs">
              New
            </span>
          ) : null}
        </div>
        <div className={HOME_CAPTION}>
          {badge.earned && badge.qualifiedOn
            ? `Earned ${shortDayLabel(badge.qualifiedOn)} · +${badge.xp} XP`
            : `${badge.criterion}${badge.current ? ` · ${badge.current.toLocaleString("en")} / ${(badge.target ?? 0).toLocaleString("en")}` : ""}`}
        </div>
      </div>
    </li>
  );
}

export function BadgesSkeleton() {
  return <div className={cn(HOME_CARD, "h-64")} aria-hidden="true" />;
}
