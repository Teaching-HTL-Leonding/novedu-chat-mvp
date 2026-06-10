import { AccessDenied } from "@/components/notice";
import { collectHealth, type HealthIndicator, type HostInfo } from "@/lib/health";
import { isEffectiveTeacher } from "@/lib/student-mode";
import pageStyles from "../page.module.css";
import styles from "./health.module.css";

// Teacher-only diagnostics: live probes of the app's dependencies (database,
// SCCH model server) plus the current session. The probes run on every request
// — this page must never be cached.
// "Effective" teacher: a teacher in student mode is denied like a student.
export const dynamic = "force-dynamic";

function StatusValue({ indicator, testId }: { indicator: HealthIndicator; testId: string }) {
  return (
    <dd className={styles.value} data-testid={testId}>
      <span className={`${styles.badge} ${indicator.ok ? styles.ok : styles.failed}`}>
        {indicator.ok ? "OK" : "Failed"}
      </span>
      {indicator.detail}
    </dd>
  );
}

function HostValue({ host, testId }: { host: HostInfo; testId: string }) {
  if (!host.fqdn) {
    return (
      <dd className={styles.value} data-testid={testId}>
        {host.error ?? "Unknown host."}
      </dd>
    );
  }
  return (
    <dd className={`${styles.value} ${styles.mono}`} data-testid={testId}>
      {host.fqdn} — {host.ips.length > 0 ? host.ips.join(", ") : (host.error ?? "no addresses")}
    </dd>
  );
}

export default async function HealthPage() {
  if (!(await isEffectiveTeacher())) {
    return (
      <main className={pageStyles.main}>
        <AccessDenied />
      </main>
    );
  }

  const health = await collectHealth();
  const userLabel = health.user
    ? [health.user.name, health.user.preferredUsername ?? health.user.email]
        .filter(Boolean)
        .join(" — ")
    : "Not signed in";

  return (
    <main className={pageStyles.main}>
      <section className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.heading}>Health</h1>
          <dl className={styles.list}>
            <div className={styles.row}>
              <dt className={styles.term}>Database connection</dt>
              <StatusValue indicator={health.db} testId="health-db" />
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>SCCH models</dt>
              <StatusValue indicator={health.scch} testId="health-scch" />
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>Signed-in user</dt>
              <dd className={styles.value} data-testid="health-user">
                {userLabel}
              </dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>Teacher</dt>
              <dd className={styles.value} data-testid="health-teacher">
                {health.teacher.realTeacher ? "Yes" : "No"}
              </dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>SQL server host</dt>
              <HostValue host={health.sqlHost} testId="health-sql-host" />
            </div>
            <div className={styles.row}>
              <dt className={styles.term}>SCCH host</dt>
              <HostValue host={health.scchHost} testId="health-scch-host" />
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
