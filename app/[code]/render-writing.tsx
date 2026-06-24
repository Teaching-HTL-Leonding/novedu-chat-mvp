import { auth } from "@/auth";
import { Notice } from "@/components/notice";
import type { CodeEntry } from "@/lib/code-store";
import { loadWriting } from "@/lib/writing-fetch";
import { getSubmission } from "@/lib/writing-store";
import { toPublicWriting } from "@/lib/writing-yaml";
import styles from "../page.module.css";
import { WritingSurface } from "./_writing/writing-surface";

// The writing module's student render: load + leniently parse the writing YAML
// from the code's file_url (uncached, so YAML edits show immediately) and ship
// ONLY the student-facing fields (never the teacher's `instructions` or the
// `model`) to the client surface. The `anonymous` flag is read LIVE from the
// loaded writing; when the activity is NOT anonymous, the student's previously
// saved text is prefilled from `novedu_writing_submissions`. The saveWriting
// action and the runtime route re-verify the code on every touch. Invoked by the
// thin module switch in app/[code]/page.tsx.
export async function RenderWriting({
  entry,
  code,
  threadId,
  threadToken,
}: {
  entry: CodeEntry;
  code: string;
  threadId: string;
  threadToken: string;
}) {
  const loaded = await loadWriting(entry.fileUrl);
  if (!loaded.ok) {
    return (
      <main className={styles.main}>
        <Notice heading="This writing activity cannot be opened">
          <p>{loaded.message}</p>
        </Notice>
      </main>
    );
  }

  // `anonymous` is read LIVE from the loaded YAML (writing DEFAULTS to false).
  // Only an attributed activity prefills + saves; an anonymous one stores nothing
  // and shows no Save button. The session user id is the Entra `oid`.
  const { anonymous } = loaded.writing;
  let initialText = "";
  if (!anonymous) {
    const session = await auth();
    const userId = session?.user?.id;
    if (userId) {
      const submission = await getSubmission(code, userId);
      if (submission) initialText = submission.text;
    }
  }

  return (
    <main className={styles.main}>
      <WritingSurface
        code={code}
        threadId={threadId}
        // The runtime re-checks both headers server-side on every request — the
        // code gates access, the token proves the thread belongs to this user.
        runtimeHeaders={{ "x-code": code, "x-thread-token": threadToken }}
        writing={toPublicWriting(loaded.writing)}
        anonymous={anonymous}
        initialText={initialText}
      />
    </main>
  );
}
