import { DataUnavailable } from "@/components/dashboard-ui";
import { FlameIcon, LockIcon } from "@/components/icons";
import { META_LABEL } from "@/components/ui/meta-label";
import { getStudentHome } from "@/lib/home-data";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";
import {
  HOME_CAPTION,
  HOME_CARD,
  HOME_CARD_PAD,
  HOME_MUTED,
  HOME_SECTION_TITLE,
  plural,
} from "./home-ui";
import { Meter } from "./meter";

// Level + XP + weekly streak. Level and XP need the usage AND the grants; the
// streak needs only the usage — each half degrades on its own.

const LINK_BUTTON =
  "self-start text-brand-deep text-sm underline decoration-brand-deep/35 underline-offset-3 hover:decoration-current";

export async function ProgressSection({ userId }: { userId: string }) {
  const { level, streak } = await getStudentHome(userId);
  return (
    <section aria-labelledby="home-progress" className={cn(HOME_CARD, "flex flex-col md:flex-row")}>
      <div className={cn(HOME_CARD_PAD, "flex min-w-0 flex-1 flex-col gap-3.5")}>
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h2 id="home-progress" className={cn(HOME_SECTION_TITLE, "text-lg")}>
            Your progress
          </h2>
          <span className={cn(HOME_MUTED, "inline-flex items-center gap-1.5")}>
            <LockIcon className="size-3.5" />
            Your progress here is only visible to you.
          </span>
        </div>
        {level ? <LevelRow {...level} /> : <DataUnavailable />}
      </div>
      <div
        className={cn(
          HOME_CARD_PAD,
          "flex flex-col justify-center gap-2.5 border-foreground/15 max-md:border-t md:min-w-72 md:border-l",
        )}
      >
        {streak ? <Streak {...streak} /> : <DataUnavailable />}
      </div>
    </section>
  );
}

function LevelRow({
  level,
  xp,
  levelStart,
  nextLevelStart,
}: {
  level: number;
  xp: number;
  levelStart: number;
  nextLevelStart: number;
}) {
  const span = nextLevelStart - levelStart;
  const into = xp - levelStart;
  const toNext = nextLevelStart - xp;
  return (
    <div className="flex items-center gap-5">
      <div className="flex flex-col leading-none">
        <span className={cn(META_LABEL, "mb-1")}>Level</span>
        <b className="font-extrabold text-5xl tabular-nums tracking-tighter md:text-6xl">{level}</b>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Meter
          value={span > 0 ? into / span : 0}
          fillClassName="bg-brand-deep"
          className="h-3.5"
          role="progressbar"
          aria-label="XP toward the next level"
          aria-valuemin={0}
          aria-valuemax={span}
          aria-valuenow={into}
          aria-valuetext={`${xp.toLocaleString("en")} XP, level ${level}, ${toNext.toLocaleString("en")} XP to level ${level + 1}`}
        />
        <div className="flex justify-between gap-3 text-sm">
          <span>
            <b className="font-semibold tabular-nums">{xp.toLocaleString("en")}</b> XP
          </span>
          <span className="text-foreground/65 tabular-nums">
            {toNext.toLocaleString("en")} XP to level {level + 1}
          </span>
        </div>
        <Disclosure
          label="How XP works"
          controls="home-xp-explain"
          buttonPlacement="start"
          buttonClassName={LINK_BUTTON}
          className="flex flex-col gap-2"
        >
          <p
            id="home-xp-explain"
            className={cn(
              HOME_MUTED,
              "hidden max-w-prose group-data-[expanded=true]/disclosure:block",
            )}
          >
            Every day you're active gives 10 XP. Answers and saves don't earn XP one by one; they
            can unlock badges, and each badge adds its XP once.
          </p>
        </Disclosure>
      </div>
    </div>
  );
}

function Streak({
  weeks,
  recent,
  thisWeekDays,
}: {
  weeks: number;
  recent: boolean[];
  thisWeekDays: number;
}) {
  let note: string;
  if (thisWeekDays > 0) {
    note = `This week counts already: active on ${plural(thisWeekDays, "day", "days")}. A week counts once you're active on any day.`;
  } else if (weeks > 0) {
    note = "This week isn't over yet. Be active on any day to keep the streak.";
  } else {
    note = "Be active this week to start a streak.";
  }
  return (
    <>
      <div className="flex items-center gap-2.5">
        <FlameIcon className="size-7 text-fam-rhythm" />
        <b className="font-bold text-2xl tabular-nums tracking-tight">{weeks}</b>
        <span className="font-medium">{weeks === 1 ? "week in a row" : "weeks in a row"}</span>
      </div>
      <div>
        <div className="flex gap-1.5" aria-hidden="true">
          {recent.map((active, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of week slots
              key={i}
              className={cn(
                "size-5.5 rounded-md",
                active ? "bg-fam-rhythm" : "bg-heat-0",
                i === recent.length - 1 && "outline-2 outline-fam-rhythm outline-offset-2",
              )}
            />
          ))}
        </div>
        <div className={cn(HOME_CAPTION, "mt-1 flex justify-between")} aria-hidden="true">
          <span>{recent.length - 1} weeks ago</span>
          <span>this week</span>
        </div>
      </div>
      <p className={cn(HOME_MUTED, "max-w-xs")}>{note}</p>
    </>
  );
}

export function ProgressSkeleton() {
  return <div className={cn(HOME_CARD, "h-48")} aria-hidden="true" />;
}
