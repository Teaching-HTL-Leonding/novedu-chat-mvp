import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { auth } from "@/auth";
import { Notice } from "@/components/notice";
import { recordRecentCode, removeRecentCode } from "@/lib/recent-code-store";
import { getThreadTokenSecret, signThreadToken } from "@/lib/thread-token";
import { checkTutorCode } from "@/lib/tutor-code-store";
import { defaultFetcher, loadAndBuildTutorPrompt, sampleExampleQuestions } from "@/lib/tutors";
import styles from "../page.module.css";
import { TutorChat } from "../tutor-chat";
import { TutorCodeError } from "../tutor-code-error";
import { ErrorList, WarningList } from "../validate-tutor/result-views";

// The chat, reachable ONLY through a Tutor Code created by a teacher
// (`/<code>`). This is a server component on purpose: the code's existence, its
// availability window, and the tutor YAML are all checked server-side, so
// nothing the browser does can skip the checks. (The chat runtime route
// re-checks the code on every request — this page only decides what to render.)
//
// Being a single dynamic segment, this route also catches every unknown
// top-level path (`/whatever`) — checkTutorCode pattern-rejects those without a
// database round-trip and the student sees "unknown tutor code". Static routes
// (`/share-tutor`, `/tutor-codes`, …) take precedence over this segment.
export default async function TutorCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const verification = await checkTutorCode(code);
  if (!verification.ok) {
    // A definitively dead code (unknown or expired) disappears from the
    // user's recent-codes shortcuts; transient failures and not-yet-started
    // codes survive. Off the response path — the student sees the error page
    // immediately either way.
    const { reason } = verification;
    if (userId && (reason === "unknown-code" || reason === "expired")) {
      after(() => removeRecentCode(userId, code));
    }
    return (
      <main className={styles.main}>
        <TutorCodeError verification={verification} />
      </main>
    );
  }
  const { entry } = verification;

  // The chat cannot work without a user id: the runtime route binds every
  // thread to the session user via the ownership token below. The Entra gate
  // (proxy.ts) guarantees a session, so this only catches a stale cookie shape.
  if (!userId) {
    return (
      <main className={styles.main}>
        <Notice heading="Session problem">
          <p>Your session is missing required user information. Sign out and sign in again.</p>
        </Notice>
      </main>
    );
  }
  // Remember the successful open as a shortcut on the entry page.
  after(() => recordRecentCode(userId, code));

  // The Mastra thread id is generated HERE, server-side, and signed together
  // with the code and the session user. The chat runtime route only accepts
  // thread-touching requests whose (code, user, threadId) triple matches the
  // token — that, not Mastra, is what isolates students' chats from each other
  // (see lib/thread-token.ts). A page reload starts a fresh thread, exactly as
  // the client-generated ids did before.
  const threadId = randomUUID();
  const threadToken = signThreadToken({ code, userId, threadId }, getThreadTokenSecret());

  // The code is genuine and within its window — now the tutor itself must be
  // valid. (Deliberately uncached for this early preview: one fetch chain per
  // page load keeps edits to the tutor YAML visible immediately.)
  const result = await loadAndBuildTutorPrompt(entry.tutorUrl, defaultFetcher);
  if (!result.ok) {
    return (
      <main className={styles.main}>
        <Notice heading="This tutor cannot be loaded">
          <p>
            The tutor behind this tutor code failed validation. Ask your teacher to check the tutor
            definition.
          </p>
        </Notice>
        <div className={styles.validationErrors}>
          {result.warnings.length > 0 ? <WarningList warnings={result.warnings} /> : null}
          <ErrorList errors={result.errors} />
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <TutorChat
        code={code}
        threadId={threadId}
        tutorUrl={entry.tutorUrl}
        // The runtime re-checks both headers server-side on every request —
        // the code gates access, the token proves the thread belongs to this
        // user. They are all the client has to (and can) say about itself.
        runtimeHeaders={{ "x-tutor-code": code, "x-thread-token": threadToken }}
        prompt={result.prompt}
        warnings={result.warnings}
        imageInput={result.imageInput}
        title={result.title}
        description={result.description}
        exampleQuestions={sampleExampleQuestions(result.exampleQuestions)}
      />
    </main>
  );
}
