import Link from "next/link";
import { auth } from "@/auth";
import { AccessDenied, Notice } from "@/components/notice";
import { isEffectiveTeacher } from "@/lib/student-mode";
import { listValidTutorCodes } from "@/lib/tutor-code-store";
import { LocalTime } from "../local-time";
import pageStyles from "../page.module.css";
import { CopyCodeButton } from "./copy-code-button";
import styles from "./tutor-codes.module.css";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Teacher-only: lists the teacher's still-valid tutor codes (expired ones are
// garbage-collected hourly and disappear). Server component — the list comes
// straight from the database; only the copy button needs the client.
// "Effective" teacher: a teacher in student mode is denied like a student.
export default async function TutorCodesPage() {
  if (!(await isEffectiveTeacher())) {
    return (
      <main className={pageStyles.main}>
        <AccessDenied />
      </main>
    );
  }

  const session = await auth();
  const userId = session?.user?.id;
  const codes = userId ? await listValidTutorCodes(userId) : [];

  if (codes === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Tutor codes temporarily unavailable">
          <p>Your tutor codes could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }

  return (
    <main className={pageStyles.main}>
      <div className={styles.container}>
        <h1 className={styles.heading}>Shared Tutor Codes</h1>
        <p className={styles.hint}>
          All of your tutor codes that are still valid (including ones whose availability window has
          not started yet). Hover a row's name for the tutor YAML URL.
        </p>
        {codes.length === 0 ? (
          <p className={styles.empty}>
            You have no valid tutor codes right now.{" "}
            <Link href="/share-tutor">Create a tutor code</Link> to share a tutor with students.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Note</th>
                <th scope="col">Valid from</th>
                <th scope="col">Valid until</th>
                <th scope="col" className={styles.actionsHeader}>
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {codes.map((entry) => (
                <tr key={entry.code}>
                  {/* The tooltip carries the tutor YAML URL — the one piece of
                      context that does not fit a column. */}
                  <td className={styles.noteCell} title={entry.tutorUrl}>
                    {entry.note || entry.code}
                  </td>
                  <td className={styles.timeCell}>
                    <LocalTime seconds={seconds(entry.validFrom)} />
                  </td>
                  <td className={styles.timeCell}>
                    <LocalTime seconds={seconds(entry.validUntil)} />
                  </td>
                  <td className={styles.actionsCell}>
                    <Link href={`/${entry.code}`} className={styles.openLink}>
                      Open
                    </Link>
                    <CopyCodeButton code={entry.code} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
