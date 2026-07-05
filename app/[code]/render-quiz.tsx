import { Notice } from "@/components/notice";
import { Main, PageBody } from "@/components/page-main";
import type { CodeEntry } from "@/lib/code-store";
import { resolveImageRef } from "@/lib/image-resolve";
import { loadQuiz } from "@/lib/quiz-fetch";
import type { ResolvedQuiz, ResolvedQuizQuestion } from "@/lib/quiz-types";
import { toPublicQuiz } from "@/lib/quiz-yaml";
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
      <Main>
        <Notice heading="This quiz cannot be opened">
          <p>{loaded.message}</p>
        </Notice>
      </Main>
    );
  }

  // Resolve each question's optional content image to a usable URL here, at page
  // render: hosted images are minted into short-lived read SAS URLs once on the
  // server so the client runner only ever sees ready-to-render URLs.
  const publicQuiz = toPublicQuiz(loaded.quiz);
  const questions: ResolvedQuizQuestion[] = await Promise.all(
    publicQuiz.questions.map(async ({ image, ...rest }) => {
      const resolved = await resolveImageRef(image, entry.fileUrl);
      return resolved ? { ...rest, image: resolved } : rest;
    }),
  );
  const quiz: ResolvedQuiz = { ...publicQuiz, questions };

  return (
    <Main>
      {/* PageBody gives the runner the shared page canvas + window-edge
          scrollbar; the runner column centers itself (block flow). */}
      <PageBody className="block">
        <QuizRunner code={code} quiz={quiz} />
      </PageBody>
    </Main>
  );
}
