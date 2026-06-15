import Link from "next/link";
import { auth } from "@/auth";
import { ExternalLinkIcon, StatsIcon } from "@/components/icons";
import { AccessDenied, Notice } from "@/components/notice";
import { isEffectiveTeacher } from "@/lib/student-mode";
import { listTutorCodes } from "@/lib/tutor-code-store";
import { getInteractionCounts } from "@/lib/tutor-stats-store";
import { LocalTime } from "../local-time";
import pageStyles from "../page.module.css";
import { CopyCodeButton } from "./copy-code-button";
import { DeleteCodeButton } from "./delete-code-button";
import styles from "./tutor-codes.module.css";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Where "now" falls relative to a code's window. Codes are no longer garbage-
// collected, so expired ones stay listed — their chat won't open, but their
// stats are still reachable and they can be deleted.
function windowStatus(entry: { validFrom: Date; validUntil: Date }, now: Date) {
  if (now < entry.validFrom) return "upcoming" as const;
  if (now > entry.validUntil) return "expired" as const;
  return "active" as const;
}

// Teacher-only: lists ALL of the teacher's tutor codes (active, not-yet-started,
// and expired), each with how many conversations it has seen, a link to detailed
// stats, and an irreversible delete. Server component — the list and the
// per-code conversation counts come straight from the database; only the copy
// and delete buttons need the client. "Effective" teacher: a teacher in student
// mode is denied like a student.
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
  const codes = userId ? await listTutorCodes(userId) : [];

  if (codes === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Tutor codes temporarily unavailable">
          <p>Your tutor codes could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }

  // One round trip for all conversation counts. `undefined` = the count query
  // failed; the column then shows "—" rather than a wrong zero.
  const counts = await getInteractionCounts(codes.map((entry) => entry.code));
  const now = new Date();

  return (
    <main className={pageStyles.main}>
      <div className={styles.container}>
        <p className={styles.hint}>
          All of your tutor codes. Expired ones stay here so you can review their stats; delete a
          code to remove it and all of its conversation data. Hover a row's name for the tutor YAML
          URL.
        </p>
        {codes.length === 0 ? (
          <p className={styles.empty}>
            You have no tutor codes yet. <Link href="/share-tutor">Create a tutor code</Link> to
            share a tutor with students.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Note</th>
                <th scope="col">Valid from</th>
                <th scope="col">Valid until</th>
                <th scope="col" className={styles.numCell}>
                  Conversations
                </th>
                <th scope="col" className={styles.actionsHeader}>
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {codes.map((entry) => {
                const status = windowStatus(entry, now);
                const count = counts?.get(entry.code) ?? 0;
                return (
                  <tr key={entry.code}>
                    {/* The tooltip carries the tutor YAML URL — the one piece of
                        context that does not fit a column. */}
                    <td className={styles.noteCell} title={entry.tutorUrl}>
                      {entry.note || entry.code}
                      {status === "expired" ? (
                        <span className={styles.badgeExpired}>expired</span>
                      ) : status === "upcoming" ? (
                        <span className={styles.badgeUpcoming}>upcoming</span>
                      ) : null}
                    </td>
                    <td className={styles.timeCell}>
                      <LocalTime seconds={seconds(entry.validFrom)} />
                    </td>
                    <td className={styles.timeCell}>
                      <LocalTime seconds={seconds(entry.validUntil)} />
                    </td>
                    <td className={styles.numCell}>{counts === undefined ? "—" : count}</td>
                    <td className={styles.actionsCell}>
                      <Link
                        href={`/tutor-codes/${entry.code}`}
                        className={styles.iconButton}
                        aria-label="View stats"
                        title="View stats"
                      >
                        <StatsIcon />
                      </Link>
                      {status === "active" ? (
                        <Link
                          href={`/${entry.code}`}
                          className={styles.iconButton}
                          aria-label="Open"
                          title="Open chat"
                        >
                          <ExternalLinkIcon />
                        </Link>
                      ) : null}
                      <CopyCodeButton code={entry.code} />
                      <DeleteCodeButton code={entry.code} label={entry.note || entry.code} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
