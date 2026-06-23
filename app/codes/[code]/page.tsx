import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { codeModules } from "@/lib/code-modules/registry";
import { codeModuleLabels } from "@/lib/code-modules/types";
import { getCodeStats } from "@/lib/code-stats-store";
import { getCode } from "@/lib/code-store";
import { LocalTime } from "../../local-time";
import pageStyles from "../../page.module.css";
import styles from "./stats.module.css";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Teacher-only detailed stats for ONE code: how many interactions it has seen,
// (for non-anonymous activities) how many distinct students, and the list of
// interactions — each linking to a read-only view of the conversation — plus an
// optional module-specific panel (the Layer-3 stats seam). Server component; any
// effective teacher may view any code's stats (`getCode`; finer-grained RBAC is
// planned).
export default async function CodeStatsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const denied = await requireTeacherPage();
  if (denied) return denied;

  const entry = await getCode(code);

  if (entry === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Stats temporarily unavailable">
          <p>These stats could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }
  if (entry === null) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Code not found">
          <p>
            This code does not exist. <Link href="/codes">Back to codes</Link>.
          </p>
        </Notice>
      </main>
    );
  }

  // Pass the code's frozen `anonymous` flag: the store nulls every userId and
  // zeroes studentCount for anonymous codes, so the privacy gate holds at the
  // data layer (the `!entry.anonymous` checks below are belt-and-braces).
  const stats = await getCodeStats(code, entry.anonymous);
  const countLabel = codeModuleLabels[entry.module].countColumn;
  // Optional module-specific panel (e.g. a future writing module's input-development).
  const moduleStats = codeModules[entry.module].stats;
  const panel = moduleStats ? await moduleStats.renderPanel(entry) : null;

  return (
    <main className={pageStyles.main}>
      <div className={styles.container}>
        <BackLink href="/codes">Back to codes</BackLink>

        {/* The page title lives in the status bar ("Code Stats"); this is just
            context — which code these stats belong to. */}
        <p className={styles.subhead} title={entry.fileUrl}>
          {entry.note ? `${entry.note} · ` : null}
          <code className={styles.code}>{entry.code}</code>
        </p>

        {stats === undefined ? (
          <Notice heading="Stats temporarily unavailable">
            <p>The stats could not be loaded right now. Try again in a moment.</p>
          </Notice>
        ) : (
          <>
            <dl className={styles.summary}>
              <div className={styles.summaryItem}>
                <dt className={styles.summaryLabel}>{countLabel}</dt>
                <dd className={styles.summaryValue}>{stats.conversations}</dd>
              </div>
              {/* Per-student numbers exist only when the activity opted out of
                  anonymity at create time. */}
              {!entry.anonymous ? (
                <div className={styles.summaryItem}>
                  <dt className={styles.summaryLabel}>Students</dt>
                  <dd className={styles.summaryValue}>{stats.studentCount}</dd>
                </div>
              ) : null}
            </dl>

            {stats.interactions.length === 0 ? (
              <p className={styles.empty}>
                Nothing yet — a conversation counts once a student sends at least one message.
              </p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">First message</th>
                    <th scope="col">Last message</th>
                    {!entry.anonymous ? <th scope="col">Student</th> : null}
                    <th scope="col" className={styles.numCell}>
                      User messages
                    </th>
                    <th scope="col" className={styles.actionsHeader}>
                      <span className={styles.visuallyHidden}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.interactions.map((interaction) => (
                    <tr key={interaction.threadId}>
                      <td className={styles.timeCell}>
                        <LocalTime seconds={seconds(interaction.firstAt)} />
                      </td>
                      <td className={styles.timeCell}>
                        <LocalTime seconds={seconds(interaction.lastAt)} />
                      </td>
                      {!entry.anonymous ? (
                        <td className={styles.userCell} title={interaction.userId ?? undefined}>
                          {interaction.userId ?? "—"}
                        </td>
                      ) : null}
                      <td className={styles.numCell}>{interaction.userMessageCount}</td>
                      <td className={styles.actionsCell}>
                        <Link
                          href={`/codes/${entry.code}/c/${interaction.threadId}`}
                          className={styles.viewLink}
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {panel}
          </>
        )}
      </div>
    </main>
  );
}
