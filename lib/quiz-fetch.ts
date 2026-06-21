import { appHostedFetcher } from "@/lib/app-hosted-fetcher";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { parseQuiz, type Quiz } from "@/lib/quiz-yaml";

// Loads + leniently parses the quiz YAML behind a (verified) quiz URL — the quiz
// analog of `lib/tutors`' tutor loading. The single definition shared by the
// `/q` page, `submitAnswer`, `startDiscussion`, and the runtime route's quiz
// branch, so they all read the same quiz the same way.
//
// App-hosted quizzes (`<origin>/api/files/<name>`) are read straight from the
// database rather than fetched over the network, via the SHARED `appHostedFetcher`
// — the one definition of that loopback-avoiding resolution (a container may not
// be able to reach its own public origin). Anything else (e.g. a quiz hosted on
// GitHub) is fetched for real, uncached, so edits show immediately. Origin is
// resolved leniently (`resolveAppOriginOr("")`): on the read/serve path we degrade
// to a network fetch rather than hard-failing the way the authoring validator does.
//
// SERVER-ONLY: touches the database and fetches arbitrary URLs.

export type LoadQuizResult = { ok: true; quiz: Quiz } | { ok: false; message: string };

export async function loadQuiz(quizUrl: string): Promise<LoadQuizResult> {
  let content: string;
  try {
    const origin = await resolveAppOriginOr("");
    const res = await appHostedFetcher(origin)(quizUrl);
    if (!res.ok) {
      return res.status === 404
        ? { ok: false, message: "This quiz could not be found." }
        : { ok: false, message: `This quiz could not be loaded (HTTP ${res.status}).` };
    }
    content = await res.text();
  } catch {
    return { ok: false, message: "This quiz could not be loaded. Try again." };
  }
  return parseQuiz(content);
}
