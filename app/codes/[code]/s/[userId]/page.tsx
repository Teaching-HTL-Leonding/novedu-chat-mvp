import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { listStudentConversations } from "@/lib/code-stats-store";
import { getCode } from "@/lib/code-store";
import { computeTextStats } from "@/lib/writing-stats";
import { getSubmission, listSavers } from "@/lib/writing-store";
import { LocalTime } from "../../../../local-time";
import { MarkdownRenderer } from "../../../../markdown-renderer";
import { StudentConversations } from "./student-conversations";

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
      <Main>
        <Notice heading="Text temporarily unavailable">
          <p>This text could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </Main>
    );
  }
  // Only a non-anonymous writing code has per-student saved text to read.
  if (entry === null || entry.module !== "writing" || entry.anonymous) {
    return (
      <Main>
        <Notice heading="Not found">
          <p>
            No saved student text here. <Link href="/codes">Back to codes</Link>.
          </p>
        </Notice>
      </Main>
    );
  }

  const submission = await getSubmission(code, userId);
  if (submission === null) {
    return (
      <Main>
        <Notice heading="No saved text">
          <p>
            This student has not saved any text for this code.{" "}
            <Link href={`/codes/${code}`}>Back to savers</Link>.
          </p>
        </Notice>
      </Main>
    );
  }

  // listSavers carries no text bodies, so reusing it for Prev/Next is cheap.
  const savers = await listSavers(code);
  const conversations = await listStudentConversations(code, userId);
  const stats = computeTextStats(submission.text);

  const idx = savers.findIndex((s) => s.userId === userId);
  const prev = idx > 0 ? savers[idx - 1] : undefined;
  const next = idx >= 0 && idx < savers.length - 1 ? savers[idx + 1] : undefined;
  // The savers row already carries the resolved display name; fall back to the raw
  // oid when none has been recorded yet (the oid stays the hover title either way).
  const displayName = (idx >= 0 ? savers[idx]?.displayName : null) ?? userId;

  return (
    <Main>
      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6">
        <BackLink href={`/codes/${code}`}>Back to savers</BackLink>

        <div className="mt-3 mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="break-all font-bold font-mono" title={userId}>
            {displayName}
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-foreground/70 text-sm">
            <span>
              Saved <LocalTime seconds={seconds(submission.textUpdatedAt)} />
            </span>
            <span>{stats.words} words</span>
            <span>{stats.charactersExcludingWhitespace} characters</span>
          </span>
          <nav className="ml-auto flex gap-4">
            {prev ? (
              <Link
                className="font-semibold text-sm hover:underline"
                href={`/codes/${code}/s/${encodeURIComponent(prev.userId)}`}
              >
                ← Previous
              </Link>
            ) : (
              <span className="font-semibold text-foreground/35 text-sm">← Previous</span>
            )}
            {next ? (
              <Link
                className="font-semibold text-sm hover:underline"
                href={`/codes/${code}/s/${encodeURIComponent(next.userId)}`}
              >
                Next →
              </Link>
            ) : (
              <span className="font-semibold text-foreground/35 text-sm">Next →</span>
            )}
          </nav>
        </div>

        <div
          className="wrap-break-word mb-6 rounded-lg border border-foreground/15 px-5 py-4"
          data-testid="student-text"
        >
          <MarkdownRenderer content={submission.text} />
        </div>

        <section className="mt-6">
          <h2 className="mb-3 font-bold text-lg">Conversations</h2>
          <StudentConversations code={code} conversations={conversations ?? []} />
        </section>
      </div>
    </Main>
  );
}
