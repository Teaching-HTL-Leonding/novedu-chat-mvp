import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { getConversationMessages } from "@/lib/code-stats-store";
import { getCode } from "@/lib/code-store";
import { ConversationView } from "./conversation-view";

// Teacher-only, READ-ONLY view of one conversation held under a code. Any
// effective teacher may open any code's conversations (`getCode`; RBAC planned);
// `getConversationMessages` additionally re-checks the thread belongs to the
// code. There is no chat input — the same CopilotKit component that paints the
// live chat renders the transcript, nothing more.
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ code: string; threadId: string }>;
}) {
  const { code, threadId } = await params;

  const denied = await requireTeacherPage();
  if (denied) return denied;

  const entry = await getCode(code);

  if (entry === undefined) {
    return (
      <Main>
        <Notice heading="Conversation temporarily unavailable">
          <p>This conversation could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </Main>
    );
  }
  if (entry === null) {
    return (
      <Main>
        <Notice heading="Conversation not found">
          <p>
            This code does not exist. <Link href="/codes">Back to codes</Link>.
          </p>
        </Notice>
      </Main>
    );
  }

  const messages = await getConversationMessages(code, threadId);
  const backHref = `/codes/${entry.code}`;

  return (
    <Main>
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-4 pb-6">
        <BackLink href={backHref}>Back to stats</BackLink>
        {/* Title is in the status bar ("Conversation"); this is just context. */}
        <p className="mb-4 text-foreground/70 text-sm">
          {entry.note || entry.code} · read-only transcript
        </p>

        {messages === undefined ? (
          <Notice heading="Conversation temporarily unavailable">
            <p>The messages could not be loaded right now. Try again in a moment.</p>
          </Notice>
        ) : messages.length === 0 ? (
          <p className="text-foreground/70">This conversation has no messages.</p>
        ) : (
          <ConversationView messages={messages} />
        )}
      </div>
    </Main>
  );
}
