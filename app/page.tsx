import { Suspense } from "react";
import { Main, PageBody } from "@/components/page-main";
import { getSession } from "@/lib/session";
import { effectiveTeacherForSession } from "@/lib/student-mode";
import { AlmostThereSection, AlmostThereSkeleton } from "./_home/almost-there-section";
import { AttentionSection, AttentionSkeleton } from "./_home/attention-section";
import { BadgesSection, BadgesSkeleton } from "./_home/badges-section";
import { CalendarSection, CalendarSkeleton } from "./_home/calendar-section";
import { ContinueSection } from "./_home/continue-section";
import { NewsStrip } from "./_home/news-strip";
import { ProgressSection, ProgressSkeleton } from "./_home/progress-section";
import { RecentList, RecentListSkeleton } from "./_home/recent-list";
import { RefreshSection, RefreshSkeleton } from "./_home/refresh-section";
import { TeacherHeader, TeacherIntroNote } from "./_home/teacher-header";
import { TeacherKpiSection, TeacherKpiSkeleton } from "./_home/teacher-kpi-section";
import { TopActivitiesSection, TopActivitiesSkeleton } from "./_home/top-activities-section";

// The start page (docs/home.md), by EFFECTIVE role. A teacher gets the dashboard
// over their OWN codes: the greeting with the Teacher Guide, the new-badges
// strip, the attention bar, the KPIs, the top activities and their badges (the
// strip and the badges are the student page's own sections). Everyone else — students, and a teacher in
// view-as-student mode — gets the student home built from their OWN usage:
// Continue first, then the new-badges strip, progress, the season calendar, Time
// to refresh beside Almost there, and the badges. The shell flushes at once;
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

  // The greeting uses the stored Entra given name (docs/auth.md), never a word of
  // the display name, which may list the surname first; without one it is a
  // plain "Welcome back".
  const givenName = session.user.givenName?.trim() ?? "";
  if (await effectiveTeacherForSession(session)) {
    return (
      <Main>
        <PageBody>
          <TeacherHeader
            givenName={givenName}
            note={
              <Suspense fallback={null}>
                <TeacherIntroNote userId={userId} />
              </Suspense>
            }
          />
          <Suspense fallback={null}>
            <NewsStrip userId={userId} audience="teacher" />
          </Suspense>
          <Suspense fallback={<AttentionSkeleton />}>
            <AttentionSection userId={userId} />
          </Suspense>
          <Suspense fallback={<TeacherKpiSkeleton />}>
            <TeacherKpiSection userId={userId} />
          </Suspense>
          <Suspense fallback={<TopActivitiesSkeleton />}>
            <TopActivitiesSection userId={userId} />
          </Suspense>
          <Suspense fallback={<BadgesSkeleton />}>
            <BadgesSection userId={userId} audience="teacher" />
          </Suspense>
        </PageBody>
      </Main>
    );
  }
  return (
    <Main>
      <PageBody>
        <ContinueSection
          givenName={givenName}
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
