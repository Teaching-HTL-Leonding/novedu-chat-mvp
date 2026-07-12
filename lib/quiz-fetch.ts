import { loadAppHostedYaml } from "@/lib/app-hosted-yaml";
import { EMPTY_FRAGMENT_BLOCK, resolveFragmentPreamble } from "@/lib/prompt-fragments";
import { parseQuiz, type Quiz } from "@/lib/quiz-yaml";

// Loads + leniently parses the quiz YAML behind a (verified) quiz URL, via the shared
// `loadAppHostedYaml`, and resolves the document-level prompt-fragment block into the
// server-only `Quiz.fragmentPreamble` (prepended to BOTH the grader prompt and the
// discussion chat). The single definition shared by the `/q` page, `submitAnswer`,
// `startDiscussion`, and the runtime route's quiz branch, so they all read the same
// quiz the same way. SERVER-ONLY: touches the database and fetches arbitrary URLs.

export type LoadQuizResult = { ok: true; quiz: Quiz } | { ok: false; message: string };

export function loadQuiz(quizUrl: string): Promise<LoadQuizResult> {
  return loadAppHostedYaml(quizUrl, parseQuiz, "quiz", async (parsed, { url, fetcher }) => {
    const resolved = await resolveFragmentPreamble(parsed.quiz.fragmentBlock, url, fetcher);
    if (!resolved.ok) {
      // Fail closed — same hard-error path as an unfetchable activity YAML (so a
      // safety fragment that fails to resolve blocks the quiz rather than vanishing).
      return { ok: false, message: "This quiz's prompt fragments could not be loaded." };
    }
    return {
      ok: true,
      quiz: {
        ...parsed.quiz,
        fragmentBlock: EMPTY_FRAGMENT_BLOCK,
        fragmentPreamble: resolved.preamble,
      },
    };
  });
}
