import { DataUnavailable } from "@/components/dashboard-ui";
import { EyeOffIcon } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import { META_LABEL } from "@/components/ui/meta-label";
import type { BadgeBoard, BadgeItem } from "@/lib/home-data";
import { getStudentHome, getTeacherHome } from "@/lib/home-data";
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
// "Show all badges" reveals the rest. One section for both audiences: students
// get their families, teachers theirs (Reach, Authoring — no XP, none hidden).
// Hidden badges are never in the data until earned (lib/home-data.ts), so
// nothing here can leak one: the Secret column holds only earned ones, plus a
// note that more exist.

export type Audience = "student" | "teacher";

/** The audience's badges from its (shared, per-request) page data. */
export async function loadBadges(
  userId: string,
  audience: Audience,
): Promise<BadgeBoard | undefined> {
  return audience === "teacher"
    ? (await getTeacherHome(userId)).badges
    : (await getStudentHome(userId)).badges;
}

export async function BadgesSection({
  userId,
  audience = "student",
}: {
  userId: string;
  audience?: Audience;
}) {
  const badges = await loadBadges(userId, audience);
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
    <div
      id="home-badge-families"
      data-columns={badges.families.length}
      className={cn(
        "grid gap-x-7 gap-y-5 md:grid-cols-2",
        // The students' five families spread out; the teachers' two keep two wide columns.
        badges.families.length > 2 && "lg:grid-cols-3 xl:grid-cols-5",
      )}
    >
      {badges.families.map((family) => (
        <div key={family.id} data-family={family.id}>
          <h3 className={cn(META_LABEL, "mb-2")}>{family.label}</h3>
          {family.shown.length + family.more.length > 0 ? (
            <ul>
              {family.shown.map((badge) => (
                <BadgeRow key={badge.id} badge={badge} />
              ))}
              {family.more.map((badge) => (
                <BadgeRow key={badge.id} badge={badge} extra />
              ))}
            </ul>
          ) : null}
          {family.id === "secret" ? (
            <p className={cn(HOME_MUTED, "mt-1.5 flex items-center gap-2")}>
              <EyeOffIcon className="size-3.5 flex-none" />
              Secret badges show up here once you earn them.
            </p>
          ) : null}
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
            ? `Earned ${shortDayLabel(badge.qualifiedOn)}${badge.xp > 0 ? ` · +${badge.xp} XP` : ""}`
            : `${badge.criterion}${badge.current ? ` · ${badge.current.toLocaleString("en")} / ${(badge.target ?? 0).toLocaleString("en")}` : ""}`}
        </div>
      </div>
    </li>
  );
}

export function BadgesSkeleton() {
  return <div className={cn(HOME_CARD, "h-64")} aria-hidden="true" />;
}
