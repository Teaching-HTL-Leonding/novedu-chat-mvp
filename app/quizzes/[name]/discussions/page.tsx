import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { filePublicUrl } from "@/lib/file-url";
import { loadQuiz } from "@/lib/quiz-fetch";
import { getCodeStats } from "@/lib/tutor-stats-store";
import { LocalTime } from "../../../local-time";
import pageStyles from "../../../page.module.css";
// Reuse the tutor-code stats styling — the quiz Discussions view is the same
// "conversations for one resource" table, just keyed by the quiz URL.
import styles from "../../../tutor-codes/[code]/stats.module.css";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Teacher-only DISCUSSIONS stats for ONE quiz: the per-question discussion chats
// students opened, each linking to a read-only transcript. The quiz's
// discussions are grouped in Mastra by `resourceId = the quiz's public URL`, so
// this reuses the exact tutor-code stats reader (`getCodeStats`) keyed by that
// URL. The privacy flag is read LIVE from the quiz YAML (not frozen): an
// `anonymous: true` quiz redacts every student id at the data layer.
//
// Any effective teacher may view any quiz's discussions (role-gated, not
// owner-gated — same as tutor codes; finer RBAC is planned).
export default async function QuizDiscussionsPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;

  const denied = await requireTeacherPage();
  if (denied) return denied;

  const origin = await resolveAppOriginOr("");
  let resourceId: string;
  try {
    // Normalize to URL.href — the same form the signed quiz link carried, so the
    // resourceId matches what the discussions were stored under.
    resourceId = new URL(filePublicUrl(origin, name)).href;
  } catch {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Discussions unavailable">
          <p>Could not determine the app&apos;s public address. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }

  // The live anonymity flag. If the quiz file was deleted, default to anonymous
  // (privacy-safe redaction) — the discussion threads themselves still exist.
  const loaded = await loadQuiz(resourceId);
  const anonymous = loaded.ok ? loaded.quiz.anonymous : true;

  const stats = await getCodeStats(resourceId, anonymous);

  return (
    <main className={pageStyles.main}>
      <div className={styles.container}>
        <BackLink href="/files">Back to files</BackLink>

        <p className={styles.subhead} title={resourceId}>
          Discussions for <code className={styles.code}>{name}</code>
        </p>

        {stats === undefined ? (
          <Notice heading="Discussions temporarily unavailable">
            <p>The discussion stats could not be loaded right now. Try again in a moment.</p>
          </Notice>
        ) : (
          <>
            <dl className={styles.summary}>
              <div className={styles.summaryItem}>
                <dt className={styles.summaryLabel}>Discussions</dt>
                <dd className={styles.summaryValue}>{stats.conversations}</dd>
              </div>
              {!anonymous ? (
                <div className={styles.summaryItem}>
                  <dt className={styles.summaryLabel}>Students</dt>
                  <dd className={styles.summaryValue}>{stats.studentCount}</dd>
                </div>
              ) : null}
            </dl>

            {stats.interactions.length === 0 ? (
              <p className={styles.empty}>
                No discussions yet — a discussion appears once a student opens &ldquo;Chat about
                this&rdquo; on a question.
              </p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">First message</th>
                    <th scope="col">Last message</th>
                    {!anonymous ? <th scope="col">Student</th> : null}
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
                      {!anonymous ? (
                        <td className={styles.userCell} title={interaction.userId ?? undefined}>
                          {interaction.userId ?? "—"}
                        </td>
                      ) : null}
                      <td className={styles.numCell}>{interaction.userMessageCount}</td>
                      <td className={styles.actionsCell}>
                        <Link
                          href={`/quizzes/${name}/c/${interaction.threadId}`}
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
        )}
      </div>
    </main>
  );
}
