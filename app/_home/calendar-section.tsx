import { DataUnavailable } from "@/components/dashboard-ui";
import { getStudentHome } from "@/lib/home-data";
import { cn } from "@/lib/utils";
import {
  HOME_CAPTION,
  HOME_CARD,
  HOME_MUTED,
  HOME_SECTION_HEAD,
  HOME_SECTION_TITLE,
  plural,
} from "./home-ui";
import { SeasonCalendar } from "./season-calendar";

// The spine of the page: the last 26 weeks, one cell per day, badges pinned to
// the day they were earned. Needs the usage; pins need the grants.

const LEGEND_SWATCH = "inline-block size-3 rounded-sm";
const LEGEND_PIN = "ml-3 inline-block size-3.5 rounded-full ring-2 ring-card";

export async function CalendarSection({ userId }: { userId: string }) {
  const { calendar } = await getStudentHome(userId);
  return (
    <section aria-labelledby="home-calendar" className={cn(HOME_CARD, "px-4 pt-5 pb-4 md:px-6")}>
      <div className={HOME_SECTION_HEAD}>
        <h2 id="home-calendar" className={cn(HOME_SECTION_TITLE, "whitespace-nowrap")}>
          Your last 26 weeks
        </h2>
        {calendar ? (
          <div className="flex flex-wrap gap-x-4.5 gap-y-1 text-sm">
            <span>
              <b className="font-semibold tabular-nums">{calendar.activeDays}</b>{" "}
              {calendar.activeDays === 1 ? "active day" : "active days"}
            </span>
            {calendar.pinsAvailable ? (
              <span>
                <b className="font-semibold tabular-nums">{calendar.badges}</b>{" "}
                {calendar.badges === 1 ? "badge" : "badges"}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {calendar ? (
        <>
          <SeasonCalendar
            cells={calendar.cells}
            monthStarts={calendar.monthStarts}
            label={`Activity calendar: ${plural(calendar.activeDays, "active day", "active days")} in the last 26 weeks${calendar.pinsAvailable ? `, ${plural(calendar.badges, "badge", "badges")} earned` : ""}.`}
          />
          {calendar.activeDays === 0 ? (
            <p className={cn(HOME_MUTED, "mt-2")}>Your first active day will show up here.</p>
          ) : null}
          {calendar.pinsAvailable ? null : (
            <p className={cn(HOME_MUTED, "mt-2")}>
              Badges could not be loaded right now. Try again in a moment.
            </p>
          )}
          <div
            className={cn(
              HOME_CAPTION,
              "mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5",
            )}
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                Less
                <i className={cn(LEGEND_SWATCH, "bg-heat-0")} />
                <i className={cn(LEGEND_SWATCH, "bg-heat-1")} />
                <i className={cn(LEGEND_SWATCH, "bg-heat-2")} />
                <i className={cn(LEGEND_SWATCH, "bg-heat-3")} />
                More active hours
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <i className={cn(LEGEND_PIN, "bg-fam-practice")} /> badge, on the day you earned it
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <i
                  className={cn(
                    LEGEND_PIN,
                    "bg-brand-amber ring-brand-amber ring-offset-2 ring-offset-card",
                  )}
                />{" "}
                new since your last visit
              </span>
            </span>
            <span>Days and weeks in Vienna time</span>
          </div>
        </>
      ) : (
        <DataUnavailable />
      )}
    </section>
  );
}

export function CalendarSkeleton() {
  return <div className={cn(HOME_CARD, "h-80")} aria-hidden="true" />;
}
