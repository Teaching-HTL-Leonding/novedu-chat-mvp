import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { listStudentConversations } from "@/lib/code-stats-store";
import { getCode } from "@/lib/code-store";
import { computeTextStats } from "@/lib/writing-stats";
import { getSubmission, listSavers } from "@/lib/writing-store";
import { LocalTime } from "../../../../local-time";
import { MarkdownRenderer } from "../../../../markdown-renderer";
import pageStyles from "../../../../page.module.css";
import { StudentConversations } from "./student-conversations";
import styles from "./student-text.module.css";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Teacher-only page for ONE student's saved writing under a code — the centre of
// the writing review. It shows the formatted text (the point), with the student's
// conversations secondary (listed below, opened in a lightbox). Prev/Next walk the
// same ordered savers list so a teacher can read a class set straight through.
//
// Any effective teacher may read any student's text for any code (role-gated, not
// owner-gated — same as the conversation transcript page). Student Markdown is
// UNTRUSTED, so it renders ONLY through the sanitized `MarkdownRenderer`.
export default async function StudentTextPage({
  params,
}: {
  params: Promise<{ code: string; userId: string }>;
}) {
  const { code, userId: rawUserId } = await params;
  const userId = decodeURIComponent(rawUserId);

  const denied = await requireTeacherPage();
  if (denied) return denied;

  const entry = await getCode(code);

  if (entry === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Text temporarily unavailable">
          <p>This text could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }
  // Only a non-anonymous writing code has per-student saved text to read.
  if (entry === null || entry.module !== "writing" || entry.anonymous) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Not found">
          <p>
            No saved student text here. <Link href="/codes">Back to codes</Link>.
          </p>
        </Notice>
      </main>
    );
  }

  const submission = await getSubmission(code, userId);
  if (submission === null) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="No saved text">
          <p>
            This student has not saved any text for this code.{" "}
            <Link href={`/codes/${code}`}>Back to savers</Link>.
          </p>
        </Notice>
      </main>
    );
  }

  // listSavers carries no text bodies, so reusing it for Prev/Next is cheap.
  const savers = await listSavers(code);
  const conversations = await listStudentConversations(code, userId);
  const stats = computeTextStats(submission.text);

  const idx = savers.findIndex((s) => s.userId === userId);
  const prev = idx > 0 ? savers[idx - 1] : undefined;
  const next = idx >= 0 && idx < savers.length - 1 ? savers[idx + 1] : undefined;

  return (
    <main className={pageStyles.main}>
      <div className={styles.container}>
        <BackLink href={`/codes/${code}`}>Back to savers</BackLink>

        <div className={styles.header}>
          <span className={styles.student} title={userId}>
            {userId}
          </span>
          <span className={styles.meta}>
            <span>
              Saved <LocalTime seconds={seconds(submission.textUpdatedAt)} />
            </span>
            <span>{stats.words} words</span>
            <span>{stats.charactersExcludingWhitespace} characters</span>
          </span>
          <nav className={styles.nav}>
            {prev ? (
              <Link
                className={styles.navLink}
                href={`/codes/${code}/s/${encodeURIComponent(prev.userId)}`}
              >
                ← Previous
              </Link>
            ) : (
              <span className={styles.navDisabled}>← Previous</span>
            )}
            {next ? (
              <Link
                className={styles.navLink}
                href={`/codes/${code}/s/${encodeURIComponent(next.userId)}`}
              >
                Next →
              </Link>
            ) : (
              <span className={styles.navDisabled}>Next →</span>
            )}
          </nav>
        </div>

        <div className={styles.text} data-testid="student-text">
          <MarkdownRenderer content={submission.text} />
        </div>

        <section className={styles.section}>
          <h2 className={styles.heading}>Conversations</h2>
          <StudentConversations code={code} conversations={conversations ?? []} />
        </section>
      </div>
    </main>
  );
}
