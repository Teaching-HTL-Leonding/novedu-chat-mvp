import Link from "next/link";
import { auth } from "@/auth";
import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { getOwnedTutorCode } from "@/lib/tutor-code-store";
import { getConversationMessages } from "@/lib/tutor-stats-store";
import pageStyles from "../../../../page.module.css";
import styles from "./conversation.module.css";
import { ConversationView } from "./conversation-view";

// Teacher-only, READ-ONLY view of one conversation held under a tutor code. The
// teacher may only open conversations under codes they created
// (`getOwnedTutorCode`); `getConversationMessages` additionally re-checks the
// thread belongs to the code. There is no chat input — the same CopilotKit
// component that paints the live chat renders the transcript, nothing more.
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ code: string; threadId: string }>;
}) {
  const { code, threadId } = await params;

  const denied = await requireTeacherPage();
  if (denied) return denied;

  const session = await auth();
  const userId = session?.user?.id;
  const entry = userId ? await getOwnedTutorCode(code, userId) : null;

  if (entry === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Conversation temporarily unavailable">
          <p>This conversation could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }
  if (entry === null) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Conversation not found">
          <p>
            This tutor code does not exist or was not created by you.{" "}
            <Link href="/tutor-codes">Back to your tutor codes</Link>.
          </p>
        </Notice>
      </main>
    );
  }

  const messages = await getConversationMessages(code, threadId);
  const backHref = `/tutor-codes/${entry.code}`;

  return (
    <main className={pageStyles.main}>
      <div className={styles.container}>
        <BackLink href={backHref}>Back to stats</BackLink>
        {/* Title is in the status bar ("Conversation"); this is just context. */}
        <p className={styles.subhead}>{entry.note || entry.code} · read-only transcript</p>

        {messages === undefined ? (
          <Notice heading="Conversation temporarily unavailable">
            <p>The messages could not be loaded right now. Try again in a moment.</p>
          </Notice>
        ) : messages.length === 0 ? (
          <p className={styles.empty}>This conversation has no messages.</p>
        ) : (
          <ConversationView messages={messages} />
        )}
      </div>
    </main>
  );
}
