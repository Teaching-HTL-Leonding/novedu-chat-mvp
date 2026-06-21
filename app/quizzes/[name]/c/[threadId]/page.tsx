import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { filePublicUrl } from "@/lib/file-url";
import { getConversationMessages } from "@/lib/tutor-stats-store";
import pageStyles from "../../../../page.module.css";
import styles from "../../../../tutor-codes/[code]/c/[threadId]/conversation.module.css";
// Reuse the read-only transcript viewer + its styling unchanged — a quiz
// discussion is rendered exactly like a tutor conversation.
import { ConversationView } from "../../../../tutor-codes/[code]/c/[threadId]/conversation-view";

// Teacher-only, READ-ONLY view of ONE quiz discussion. Discussions are grouped
// in Mastra by `resourceId = the quiz's public URL`; `getConversationMessages`
// re-checks the thread belongs to that resource (defense in depth). The seeded
// question/answer/verdict messages render alongside any follow-up.
export default async function QuizConversationPage({
  params,
}: {
  params: Promise<{ name: string; threadId: string }>;
}) {
  const { name, threadId } = await params;

  const denied = await requireTeacherPage();
  if (denied) return denied;

  const origin = await resolveAppOriginOr("");
  let resourceId: string;
  try {
    resourceId = new URL(filePublicUrl(origin, name)).href;
  } catch {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Conversation unavailable">
          <p>Could not determine the app&apos;s public address. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }

  const messages = await getConversationMessages(resourceId, threadId);

  return (
    <main className={pageStyles.main}>
      <div className={styles.container}>
        <BackLink href={`/quizzes/${name}/discussions`}>Back to discussions</BackLink>
        <p className={styles.subhead}>{name} · read-only transcript</p>

        {messages === undefined ? (
          <Notice heading="Conversation temporarily unavailable">
            <p>The messages could not be loaded right now. Try again in a moment.</p>
          </Notice>
        ) : messages.length === 0 ? (
          <p className={styles.empty}>This discussion has no messages.</p>
        ) : (
          <ConversationView messages={messages} />
        )}
      </div>
    </main>
  );
}
