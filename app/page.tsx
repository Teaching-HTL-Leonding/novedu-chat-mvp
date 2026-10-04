import { Suspense } from "react";
import { Main, PageBody } from "@/components/page-main";
import { getSession } from "@/lib/session";
import { AlmostThereSection, AlmostThereSkeleton } from "./_home/almost-there-section";
import { BadgesSection, BadgesSkeleton } from "./_home/badges-section";
import { CalendarSection, CalendarSkeleton } from "./_home/calendar-section";
import { ContinueSection } from "./_home/continue-section";
import { NewsStrip } from "./_home/news-strip";
import { ProgressSection, ProgressSkeleton } from "./_home/progress-section";
import { RecentList, RecentListSkeleton } from "./_home/recent-list";
import { RefreshSection, RefreshSkeleton } from "./_home/refresh-section";

// The start page (docs/home.md). Signed in, every user — students, and teachers
// for now (the teacher dashboard comes later) — gets the student home built
// from their OWN usage: Continue first, then the new-badges strip, progress,
// the season calendar, Time to refresh beside Almost there, and the badges. The shell flushes at once;
// every data section streams behind its own Suspense boundary.
//
// Without a resolvable session (the proxy only checks that a cookie exists) the
// page offers just the code field.

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const userId = session?.user?.id;

  if (!userId) {
    return (
      <Main>
        <PageBody>
          <ContinueSection />
        </PageBody>
      </Main>
    );
  }

  const firstName = session.user.name?.trim().split(/\s+/)[0] ?? "";
  return (
    <Main>
      <PageBody>
        <ContinueSection
          firstName={firstName}
          recent={
            <Suspense fallback={<RecentListSkeleton />}>
              <RecentList userId={userId} />
            </Suspense>
          }
        />
        <Suspense fallback={null}>
          <NewsStrip userId={userId} />
        </Suspense>
        <Suspense fallback={<ProgressSkeleton />}>
          <ProgressSection userId={userId} />
        </Suspense>
        <Suspense fallback={<CalendarSkeleton />}>
          <CalendarSection userId={userId} />
        </Suspense>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Suspense fallback={<RefreshSkeleton />}>
            <RefreshSection userId={userId} />
          </Suspense>
          <Suspense fallback={<AlmostThereSkeleton />}>
            <AlmostThereSection userId={userId} />
          </Suspense>
        </div>
        <Suspense fallback={<BadgesSkeleton />}>
          <BadgesSection userId={userId} />
        </Suspense>
      </PageBody>
    </Main>
  );
}
