import { auth } from "@/auth";
import { AccessDenied } from "@/components/notice";
import { getTeacherView } from "@/lib/student-mode";
import { getBuildInfo } from "@/lib/version";
import pageStyles from "../page.module.css";
import { HealthDashboard } from "./health-dashboard";

// Teacher-only diagnostics. This server component only gates access and
// supplies the cheap, locally-known facts (session user, teacher role); the
// connectivity probes are fetched asynchronously by the client dashboard from
// /api/health so navigating here is instant even when a dependency times out.
// "Effective" teacher: a teacher in student mode is denied like a student.
export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const { realTeacher, effectiveTeacher } = await getTeacherView();
  if (!effectiveTeacher) {
    return (
      <main className={pageStyles.main}>
        <AccessDenied />
      </main>
    );
  }

  const session = await auth();
  const userLabel = session?.user
    ? [session.user.name, session.user.preferredUsername ?? session.user.email]
        .filter(Boolean)
        .join(" — ")
    : "Not signed in";

  return (
    <main className={pageStyles.main}>
      <HealthDashboard userLabel={userLabel} isTeacher={realTeacher} build={getBuildInfo()} />
    </main>
  );
}
