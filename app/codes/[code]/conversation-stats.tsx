import Link from "next/link";
import { Notice } from "@/components/notice";
import { codeModuleLabels } from "@/lib/code-modules/types";
import { getCodeStats } from "@/lib/code-stats-store";
import type { CodeEntry } from "@/lib/code-store";
import { LocalTime } from "../../local-time";
import styles from "./stats.module.css";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// The shared per-code detail body for modules whose review centres on the chat: a
// summary (interaction count, and student count when attributed) plus a table of
// every qualifying conversation, each row linking to a read-only transcript. tutor
// and quiz render this from their `renderDetail`; writing renders it only as the
// fallback for an anonymous code (which has no savers). The count label
// ("Conversations" vs "Discussions") comes from the module's labels.
//
// SERVER COMPONENT: reads the database via `getCodeStats`. The descriptors call it
// as a plain function so no JSX lives in the server-only registry .ts files.
export async function ConversationStats({ entry }: { entry: CodeEntry }) {
  // Pass the code's frozen `anonymous` flag: the store nulls every userId and
  // zeroes studentCount for anonymous codes, so the privacy gate holds at the data
  // layer (the `!entry.anonymous` checks below are belt-and-braces).
  const stats = await getCodeStats(entry.code, entry.anonymous);
  const countLabel = codeModuleLabels[entry.module].countColumn;

  if (stats === undefined) {
    return (
      <Notice heading="Stats temporarily unavailable">
        <p>The stats could not be loaded right now. Try again in a moment.</p>
      </Notice>
    );
  }

  return (
    <>
      <dl className={styles.summary}>
        <div className={styles.summaryItem}>
          <dt className={styles.summaryLabel}>{countLabel}</dt>
          <dd className={styles.summaryValue}>{stats.conversations}</dd>
        </div>
        {/* Per-student numbers exist only when the activity opted out of anonymity
            at create time. */}
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
                    {interaction.userName ?? interaction.userId ?? "—"}
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
    </>
  );
}
