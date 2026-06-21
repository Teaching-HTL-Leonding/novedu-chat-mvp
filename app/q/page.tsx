import { Notice } from "@/components/notice";
import { loadQuiz } from "@/lib/quiz-fetch";
import { getQuizLinkSecret, verifyQuizLink } from "@/lib/quiz-link";
import { toPublicQuiz } from "@/lib/quiz-yaml";
import styles from "../page.module.css";
import { QuizLinkError } from "../share-quiz/quiz-link-error";
import { QuizRunner } from "./quiz-runner";

// The student-facing quiz, reachable ONLY through a signed quiz link
// (`/q?quiz=…&start=…&end=…&sig=…`). A STATIC `/q` segment, so it wins over the
// `/[code]` dynamic catch-all. This is a server component on purpose: the link
// signature + availability window are verified server-side, the quiz YAML is
// loaded + leniently parsed here, and ONLY the student-facing fields (never the
// `evaluation` grading prompts) are shipped to the client runner. The
// `submitAnswer` / `startDiscussion` actions and the runtime route re-verify the
// link on every touch, so a tampered or expired link is caught everywhere.
//
// The whole app is behind the Entra gate (proxy.ts), so the visitor is
// authenticated; the signed link is what authorizes THIS quiz.
export default async function QuizPage({
  searchParams,
}: {
  searchParams: Promise<{ quiz?: string; start?: string; end?: string; sig?: string }>;
}) {
  const params = await searchParams;
  const verification = verifyQuizLink(params, getQuizLinkSecret(), Math.floor(Date.now() / 1000));
  if (!verification.ok) {
    return (
      <main className={styles.main}>
        <QuizLinkError verification={verification} />
      </main>
    );
  }

  const loaded = await loadQuiz(verification.quiz);
  if (!loaded.ok) {
    return (
      <main className={styles.main}>
        <Notice heading="This quiz cannot be opened">
          <p>{loaded.message}</p>
        </Notice>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <QuizRunner
        quiz={toPublicQuiz(loaded.quiz)}
        link={{
          quiz: verification.quiz,
          start: String(verification.start),
          end: String(verification.end),
          sig: verification.sig,
        }}
      />
    </main>
  );
}
