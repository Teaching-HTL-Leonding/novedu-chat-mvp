import { Notice } from "@/components/notice";
import type { CodeEntry } from "@/lib/code-store";
import { loadQuiz } from "@/lib/quiz-fetch";
import { toPublicQuiz } from "@/lib/quiz-yaml";
import styles from "../page.module.css";
import { QuizRunner } from "./_quiz/quiz-runner";

// The quiz module's student render: load + leniently parse the quiz YAML from the
// code's file_url and ship ONLY the student-facing fields (never the `evaluation`
// grading prompts) to the client runner. The submitAnswer / startDiscussion
// actions and the runtime route re-verify the code on every touch. Invoked by the
// thin module switch in app/[code]/page.tsx.
export async function RenderQuiz({ entry, code }: { entry: CodeEntry; code: string }) {
  const loaded = await loadQuiz(entry.fileUrl);
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
      <QuizRunner code={code} quiz={toPublicQuiz(loaded.quiz)} />
    </main>
  );
}
