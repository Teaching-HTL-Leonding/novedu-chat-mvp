import { loadAppHostedYaml } from "@/lib/app-hosted-yaml";
import { parseQuiz, type Quiz } from "@/lib/quiz-yaml";

// Loads + leniently parses the quiz YAML behind a (verified) quiz URL, via the shared
// `loadAppHostedYaml`. The single definition shared by the `/q` page, `submitAnswer`,
// `startDiscussion`, and the runtime route's quiz branch, so they all read the same
// quiz the same way. SERVER-ONLY: touches the database and fetches arbitrary URLs.

export type LoadQuizResult = { ok: true; quiz: Quiz } | { ok: false; message: string };

export function loadQuiz(quizUrl: string): Promise<LoadQuizResult> {
  return loadAppHostedYaml(quizUrl, parseQuiz, "quiz");
}
