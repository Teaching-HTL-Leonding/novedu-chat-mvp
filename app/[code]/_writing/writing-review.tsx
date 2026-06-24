import { MarkdownRenderer } from "@/app/markdown-renderer";
import { listSubmissions } from "@/lib/writing-store";
import { LocalTime } from "../../local-time";
import styles from "./writing-review.module.css";

// The Writing module's teacher review panel — the Layer-3 stats seam rendered
// below the generic stats shell on /codes/[code]. READ-ONLY: it lists every
// student's saved text (one row per student, newest save first) with no editing
// and no feedback. The student's Markdown is UNTRUSTED, so it is rendered ONLY
// through `MarkdownRenderer` (react-markdown, no rehype-raw, URL-scheme
// allowlisted — the same sanitized renderer the rest of the app uses).
//
// Access is ROLE-gated upstream: the /codes/[code] page already calls
// `requireTeacherPage()`, so any effective teacher may review any code. An
// anonymous writing code never accumulates submission rows, so the review is
// simply empty for it.
//
// SERVER COMPONENT: reads the database via `listSubmissions`. The descriptor in
// lib/code-modules/writing.ts calls this as a plain function to keep JSX out of
// that server-only .ts file.

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export async function WritingReview({ code, anonymous }: { code: string; anonymous: boolean }) {
  const submissions = await listSubmissions(code);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Submissions</h2>
      {submissions.length === 0 ? (
        <p className={styles.empty}>
          Nothing yet — a submission appears once a student saves their text.
        </p>
      ) : (
        <ul className={styles.list}>
          {submissions.map((submission) => (
            <li key={submission.userId} className={styles.item}>
              <div className={styles.meta}>
                {/* Anonymous writing codes hold no rows, so the student id is only
                    shown when attribution applies; the flag is belt-and-braces. */}
                {!anonymous ? (
                  <span className={styles.user} title={submission.userId}>
                    {submission.userId}
                  </span>
                ) : null}
                <span className={styles.time}>
                  <LocalTime seconds={seconds(submission.textUpdatedAt)} />
                </span>
              </div>
              <div className={styles.text}>
                <MarkdownRenderer content={submission.text} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
