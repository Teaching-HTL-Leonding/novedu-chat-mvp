import { loadAppHostedYaml } from "@/lib/app-hosted-yaml";
import type { ImageRef } from "@/lib/image-ref";
import {
  assembleFragmentPrompt,
  assembleFragmentPrompts,
  EMPTY_FRAGMENT_BLOCK,
  type Fetcher,
  resolveFragmentUrl,
} from "@/lib/prompt-fragments";
import { parseQuiz, type Quiz, type QuizFileRef, type QuizQuestion } from "@/lib/quiz-yaml";

// Loads + leniently parses the quiz YAML behind a (verified) quiz URL, via the shared
// `loadAppHostedYaml`, renders the quiz's TWO host texts (with any inline
// `{{fragment}}` / `{{file}}` markers resolved in place) against the document's ONE
// fragment block — `instructions` into the server-only `Quiz.instructionsPreamble`
// (prepended to BOTH the grader prompt and the discussion chat) and
// `discussion.instructions` back into `Quiz.discussionInstructions` (the discussion
// chat only) — and resolves any `quiz_files` LIVE INCLUDES: every question of every
// referenced quiz file is pulled fresh, namespaced `"<alias>/<id>"`, and merged into
// the pool, so downstream a compound quiz is just a `Quiz` with more questions.
// The single definition shared by the `/q` page, `submitAnswer`, `startDiscussion`,
// and the runtime route's quiz branch, so they all read the same quiz the same way.
// SERVER-ONLY: touches the database and fetches arbitrary URLs.
//
// Include resolution is FAIL-CLOSED (same pattern as fragment failures — the final
// exam must never silently shrink): a malformed ref, a duplicate alias, an
// unfetchable include, an include that does not parse as a quiz, a nested
// `quiz_files` declaration (includes are one level deep), or a failing source
// preamble all fail the whole load with a friendly student-facing message.

export type LoadQuizResult = { ok: true; quiz: Quiz } | { ok: false; message: string };

type IncludeResult = { ok: true; questions: QuizQuestion[] } | { ok: false; message: string };

/**
 * Renders ONE quiz document's `instructions` host text against its OWN fragment
 * block, relative to its OWN URL (`validateLibraries: false` — the hot path). Used
 * for each included source quiz, so an imported question's `sourcePreamble` is
 * exactly what its chapter quiz would grade with. (The root document renders its
 * two host texts — `instructions` + `discussion.instructions` — in `loadQuiz`.)
 */
async function renderPreamble(
  quiz: Quiz,
  url: string,
  fetcher: Fetcher,
): Promise<{ ok: true; preamble: string } | { ok: false }> {
  const resolved = await assembleFragmentPrompt(
    quiz.fragmentBlock,
    url,
    fetcher,
    { validateLibraries: false },
    quiz.instructions ?? "",
  );
  if (!resolved.ok) return { ok: false };
  return { ok: true, preamble: resolved.prompt.trimEnd() };
}

/**
 * Absolutize an imported question's content image against the SOURCE quiz URL, so
 * a `./diagram.png` next to the chapter quiz still resolves from the compound quiz
 * (whose own `file_url` is elsewhere). Hosted NAMES and absolute URLs pass through
 * unchanged — they resolve the same from anywhere.
 */
function absolutizeImage(image: ImageRef | undefined, sourceUrl: string): ImageRef | undefined {
  if (!image || image.hosted === true || /^https?:\/\//i.test(image.src)) return image;
  try {
    return { ...image, src: resolveFragmentUrl(image.src, sourceUrl) };
  } catch {
    // An unresolvable relative path can't render either way; keep the ref and let
    // the lenient `resolveImageRef` omit it (images are non-secret decoration).
    return image;
  }
}

/** Resolve ONE `quiz_files` include into its namespaced, import-transformed questions. */
async function resolveInclude(
  ref: QuizFileRef,
  baseUrl: string,
  fetcher: Fetcher,
): Promise<IncludeResult> {
  // The ref was lifted leniently — re-check its shape fail-closed here. The alias
  // must be usable as a question-id prefix: non-empty, no dot (the fragment-alias
  // rule), and no slash (it delimits `"<alias>/<id>"`).
  const alias = typeof ref?.id === "string" ? ref.id.trim() : "";
  const rawUrl = typeof ref?.url === "string" ? ref.url.trim() : "";
  if (!alias || /[./]/.test(alias) || !rawUrl) {
    return { ok: false, message: "This quiz declares an invalid quiz_files entry." };
  }

  let sourceUrl: string;
  try {
    sourceUrl = resolveFragmentUrl(rawUrl, baseUrl);
  } catch {
    return { ok: false, message: `The included quiz "${alias}" has an invalid URL.` };
  }
  // Same SSRF scheme gate as fragment refs: the lenient lift skipped the schema's
  // URL refine, so this is the structural http(s)-only backstop.
  let scheme: string;
  try {
    scheme = new URL(sourceUrl).protocol;
  } catch {
    scheme = "";
  }
  if (scheme !== "http:" && scheme !== "https:") {
    return { ok: false, message: `The included quiz "${alias}" has an invalid URL.` };
  }

  let body: string;
  try {
    const res = await fetcher(sourceUrl);
    if (!res.ok) {
      return { ok: false, message: `The included quiz "${alias}" could not be loaded.` };
    }
    body = await res.text();
  } catch {
    return { ok: false, message: `The included quiz "${alias}" could not be loaded.` };
  }

  const parsed = parseQuiz(body);
  if (!parsed.ok) {
    return { ok: false, message: `The included quiz "${alias}" is not a usable quiz file.` };
  }
  // One level deep only — no recursion, no cycles.
  if (parsed.quiz.quizFiles.length > 0) {
    return {
      ok: false,
      message: `The included quiz "${alias}" itself includes other quizzes — includes cannot be nested.`,
    };
  }

  // The source's own preamble, rendered with the SOURCE's fragment block relative to
  // the SOURCE URL — it travels with each imported question as `sourcePreamble`.
  const preamble = await renderPreamble(parsed.quiz, sourceUrl, fetcher);
  if (!preamble.ok) {
    return {
      ok: false,
      message: `The included quiz "${alias}"'s prompt fragments could not be loaded.`,
    };
  }

  const source = parsed.quiz;
  const questions = source.questions.map(
    (q): QuizQuestion => ({
      ...q,
      // Namespaced id — cross-chapter collisions impossible by construction.
      id: `${alias}/${q.id}`,
      // Materialize the SOURCE-effective photo-answers flag as an explicit
      // per-question boolean (the compound quiz's own `llm.imageInput` must not
      // re-interpret an imported question).
      imageInput: q.imageInput ?? source.imageInput,
      image: absolutizeImage(q.image, sourceUrl),
      ...(preamble.preamble ? { sourcePreamble: preamble.preamble } : {}),
    }),
  );
  return { ok: true, questions };
}

export function loadQuiz(quizUrl: string): Promise<LoadQuizResult> {
  return loadAppHostedYaml(quizUrl, parseQuiz, "quiz", async (parsed, { url, fetcher }) => {
    // Runtime hot path: `validateLibraries: false`. The quiz has TWO host texts —
    // `instructions` and `discussion.instructions` — rendered in ONE pass against the
    // document's fragment block (libraries/text files fetched once); with no
    // fragment_files both return verbatim, off the network entirely.
    const resolved = await assembleFragmentPrompts(
      parsed.quiz.fragmentBlock,
      url,
      fetcher,
      { validateLibraries: false },
      [parsed.quiz.instructions ?? "", parsed.quiz.discussionInstructions ?? ""],
    );
    if (!resolved.ok) {
      // Fail closed — same hard-error path as an unfetchable activity YAML (so a
      // safety fragment that fails to resolve blocks the quiz rather than vanishing).
      return { ok: false, message: "This quiz's prompt fragments could not be loaded." };
    }
    const [instructionsPreamble = "", discussionInstructions = ""] = resolved.prompts;

    // Resolve the live includes (in parallel, merged in DECLARED order). Duplicate
    // aliases are an authoring error — fail closed rather than guessing.
    const refs = parsed.quiz.quizFiles;
    const aliases = new Set<string>();
    for (const ref of refs) {
      const alias = typeof ref?.id === "string" ? ref.id.trim() : "";
      if (aliases.has(alias)) {
        return {
          ok: false,
          message: `This quiz declares the included-quiz alias "${alias}" twice.`,
        };
      }
      aliases.add(alias);
    }
    const includes = await Promise.all(refs.map((ref) => resolveInclude(ref, url, fetcher)));
    const imported: QuizQuestion[] = [];
    for (const include of includes) {
      if (!include.ok) return include;
      imported.push(...include.questions);
    }

    const questions = [...parsed.quiz.questions, ...imported];
    // parseQuiz + resolveInclude make an empty pool unreachable (each parsed quiz has
    // ≥ 1 complete question or fails) — keep the backstop anyway; never run empty.
    if (questions.length === 0) {
      return { ok: false, message: "This quiz has no questions." };
    }

    return {
      ok: true,
      quiz: {
        ...parsed.quiz,
        fragmentBlock: EMPTY_FRAGMENT_BLOCK,
        quizFiles: [],
        instructionsPreamble: instructionsPreamble.trimEnd(),
        // The rendered discussion guidance replaces the authored host text — empty
        // (e.g. no `discussion:` block) collapses back to "none".
        discussionInstructions:
          discussionInstructions.trim() !== "" ? discussionInstructions.trimEnd() : undefined,
        questions,
      },
    };
  });
}
