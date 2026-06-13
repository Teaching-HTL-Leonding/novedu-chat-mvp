import { auth } from "@/auth";
import { listRecentCodes } from "@/lib/recent-code-store";
import styles from "./page.module.css";
import { TutorCodeEntry } from "./tutor-code-entry";

// The chat entry page: a chat is always opened through a Tutor Code
// (`/<code>`), so the root URL offers a form to type (or paste) one, plus the
// user's recently used codes (from `novedu_recent_codes`, recorded server-side
// on every successful chat open) as one-click shortcuts.
export default async function Home() {
  const session = await auth();
  const userId = session?.user?.id;
  const recent = userId ? await listRecentCodes(userId) : [];

  return (
    <main className={styles.main}>
      <TutorCodeEntry recent={recent.map(({ code, note }) => ({ code, note }))} />
    </main>
  );
}
