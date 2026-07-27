"use client";

import { useEffect, useRef, useState } from "react";
import { ContentImage } from "@/components/content-image";
import { ReportButton } from "@/components/report-button";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { FieldError } from "@/components/ui/field";
import { IMAGE_ACCEPT, MAX_IMAGES_PER_ANSWER, readAnswerImage } from "@/lib/answer-images";
import { startDiscussion, submitAnswer } from "@/lib/quiz-actions";
import {
  type QuizVerdict,
  type ResolvedQuiz,
  type ResolvedQuizQuestion,
  verdictLabel,
} from "@/lib/quiz-types";
import { buildRuntimeHeaders } from "@/lib/runtime-headers";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "../../markdown-renderer";
import { QuizDiscussion } from "./quiz-discussion";

// The quiz page column: centered and capped inside the PageBody canvas (which
// owns the horizontal gutter).
const RUNNER = "mx-auto flex w-full max-w-4xl flex-col gap-4";
const PROGRESS = "text-foreground/55 text-sm";
const CARD = "rounded-xl border border-foreground/15 bg-card px-5 py-4";
const LABEL = "mb-1.5 block font-semibold text-sm";
const ACTIONS = "flex flex-wrap items-center gap-2";

// Verdict accent: the card/tile sets a local --verdict var per result;
// descendants (left border, heading, summary number, tile top border) consume
// it, so each verdict color lives in one place. (Named --verdict, not --accent:
// the global shadcn token block defines --accent.)
const VERDICT_VARS: Record<QuizVerdict, string> = {
  correct: "[--verdict:var(--color-success)]",
  partial: "[--verdict:var(--color-warning)]",
  incorrect: "[--verdict:var(--color-destructive)]",
};

// The student-facing quiz runner. Walks the (optionally shuffled) questions one
// at a time: render the markdown question, take a free-text answer, grade it via
// the `submitAnswer` action (LLM verdict + feedback), then offer Next / Finish /
// an inline discussion. The quiz CODE travels with every action so the server
// re-verifies it each time. NOTHING is stored about the run — the summary is
// client-only and a reload restarts the quiz.

type VerdictCounts = Record<QuizVerdict, number>;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function QuizRunner({ quiz, code }: { quiz: ResolvedQuiz; code: string }) {
  // Shuffle on the CLIENT after mount: server and first client render both use
  // the authored order (no hydration mismatch), then the effect reorders once.
  // `ready` gates the questions so the first visible question never flickers.
  const [order, setOrder] = useState<ResolvedQuizQuestion[]>(quiz.questions);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setOrder(quiz.shuffle ? shuffle(quiz.questions) : quiz.questions);
    setReady(true);
  }, [quiz]);

  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  // Photo answers (only offered when the current question's `imageInput` is
  // true): validated client-side by the shared helper, sent as data URLs, and
  // re-validated server-side. `imageError` is the dismissible upload notice.
  const [images, setImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [grading, setGrading] = useState(false);
  const [verdict, setVerdict] = useState<{ result: QuizVerdict; feedback: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<VerdictCounts>({ correct: 0, partial: 0, incorrect: 0 });
  const [answered, setAnswered] = useState(0);
  const [finished, setFinished] = useState(false);
  const [discussion, setDiscussion] = useState<{
    threadId: string;
    threadToken: string;
    feedback: string;
  } | null>(null);
  const [openingDiscussion, setOpeningDiscussion] = useState(false);
  // The discussion lives in a modal DialogShell overlaying the page; closing
  // keeps the thread so the student can reopen it ("Continue discussion")
  // until they move on.
  const [discussionOpen, setDiscussionOpen] = useState(false);

  if (!ready) {
    return (
      <div className={RUNNER}>
        <p className={PROGRESS}>Preparing quiz…</p>
      </div>
    );
  }

  const total = order.length;
  const current = order[index];

  if (finished || !current) {
    return <Summary counts={counts} answered={answered} total={total} />;
  }

  const isLast = index >= total - 1;

  // Validate + read the picked files (camera or gallery). Accepted photos become
  // thumbnails; every rejected file's reason lands in one dismissible notice.
  async function handleAddImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const errors: string[] = [];
    const accepted: { name: string; dataUrl: string }[] = [];
    let count = images.length;
    for (const file of Array.from(files)) {
      if (count >= MAX_IMAGES_PER_ANSWER) {
        errors.push(`${file.name}: at most ${MAX_IMAGES_PER_ANSWER} photos per answer.`);
        continue;
      }
      const read = await readAnswerImage(file);
      if (read.ok) {
        accepted.push({ name: file.name, dataUrl: read.dataUrl });
        count += 1;
      } else {
        errors.push(read.message);
      }
    }
    if (accepted.length > 0) setImages((prev) => [...prev, ...accepted]);
    setImageError(errors.length > 0 ? errors.join(" ") : null);
  }

  async function handleSubmit(question: ResolvedQuizQuestion) {
    const trimmed = answer.trim();
    if ((!trimmed && images.length === 0) || grading) return;
    setGrading(true);
    setError(null);
    const res = await submitAnswer({
      code,
      questionId: question.id,
      answer: trimmed,
      images: images.map((image) => image.dataUrl),
    });
    setGrading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setVerdict({ result: res.result, feedback: res.feedback });
    setCounts((c) => ({ ...c, [res.result]: c[res.result] + 1 }));
    setAnswered((n) => n + 1);
  }

  async function handleOpenDiscussion(question: ResolvedQuizQuestion) {
    if (!verdict || openingDiscussion || discussion) return;
    setOpeningDiscussion(true);
    setError(null);
    const res = await startDiscussion({
      code,
      questionId: question.id,
      answer: answer.trim(),
      result: verdict.result,
      feedback: verdict.feedback,
      // The same photos the answer was graded with — seeded into the thread so
      // the discussion agent (and the teacher's transcript) sees them.
      images: images.map((image) => image.dataUrl),
    });
    setOpeningDiscussion(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setDiscussion({
      threadId: res.threadId,
      threadToken: res.threadToken,
      feedback: verdict.feedback,
    });
    setDiscussionOpen(true);
  }

  function reset() {
    // Drop the thread for this question (DialogShell closes itself on unmount).
    setDiscussionOpen(false);
    setDiscussion(null);
    setVerdict(null);
    setAnswer("");
    setImages([]);
    setImageError(null);
    setError(null);
  }

  function goNext() {
    reset();
    if (isLast) setFinished(true);
    else setIndex((i) => i + 1);
  }

  return (
    <div className={RUNNER}>
      {quiz.title || quiz.description ? (
        <header>
          {quiz.title ? <h1 className="font-bold text-2xl">{quiz.title}</h1> : null}
          {quiz.description ? <MarkdownRenderer content={quiz.description} /> : null}
        </header>
      ) : null}

      <p className={PROGRESS}>
        Question {index + 1} of {total}
      </p>

      <section className={CARD}>
        {current.title ? <h2 className="mb-2 font-semibold text-lg">{current.title}</h2> : null}
        {current.image ? <ContentImage image={current.image} /> : null}
        <MarkdownRenderer content={current.question} />
      </section>

      {!verdict ? (
        <section className={CARD}>
          <label className={LABEL} htmlFor="quiz-answer">
            Your answer
          </label>
          <textarea
            id="quiz-answer"
            className="mb-3 min-h-28 w-full resize-y rounded-lg border border-foreground/25 bg-background px-3 py-2.5 text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={grading}
            placeholder="Type your answer…"
          />
          {imageError ? (
            <div
              className="mb-3 flex items-center gap-3 rounded-lg border border-destructive/45 bg-destructive/10 px-3 py-2 text-sm"
              role="alert"
            >
              <span className="wrap-anywhere min-w-0 flex-1">{imageError}</span>
              <Button variant="outline" size="sm" onClick={() => setImageError(null)}>
                Dismiss
              </Button>
            </div>
          ) : null}
          {images.length > 0 ? (
            <AnswerThumbnails
              images={images}
              disabled={grading}
              onRemove={(i) => setImages((prev) => prev.filter((_, j) => j !== i))}
            />
          ) : null}
          <div className={ACTIONS}>
            <Button
              onClick={() => handleSubmit(current)}
              disabled={grading || (answer.trim() === "" && images.length === 0)}
            >
              {grading ? "Checking…" : "Submit answer"}
            </Button>
            {current.imageInput ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={grading || images.length >= MAX_IMAGES_PER_ANSWER}
                >
                  Add photo
                </Button>
                {/* Hidden picker: `accept` offers the camera directly on phones. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleAddImages(event.target.files);
                    // Allow re-picking the same file after a remove.
                    event.target.value = "";
                  }}
                />
              </>
            ) : null}
            <Button variant="outline" onClick={() => setFinished(true)} disabled={grading}>
              Finish
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section className={CARD}>
            <span className={LABEL}>Your answer</span>
            {answer.trim() !== "" ? (
              <p className="whitespace-pre-wrap leading-relaxed">{answer}</p>
            ) : null}
            {images.length > 0 ? <AnswerThumbnails images={images} /> : null}
          </section>
          <section
            className={cn(CARD, "border-l-(--verdict) border-l-4", VERDICT_VARS[verdict.result])}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-bold text-(--verdict) text-base capitalize">
                {verdictLabel(verdict.result)}
              </h3>
              {/* Report this graded answer. The quiz grade persists nothing, so
                  the report carries its own snapshot: the answer/verdict/feedback
                  just graded (still held in state until Next). The server re-loads
                  the authoritative question text (see lib/report-actions.ts). */}
              <ReportButton
                target={{
                  kind: "quiz-answer",
                  code,
                  questionId: current.id,
                  answer,
                  result: verdict.result,
                  feedback: verdict.feedback,
                  hadImages: images.length > 0,
                }}
              />
            </div>
            <MarkdownRenderer content={verdict.feedback} />
          </section>
          <div className={ACTIONS}>
            {!discussion ? (
              <Button
                variant="outline"
                onClick={() => handleOpenDiscussion(current)}
                disabled={openingDiscussion}
              >
                {openingDiscussion ? "Opening…" : "Chat about this"}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setDiscussionOpen(true)}>
                Continue discussion
              </Button>
            )}
            <Button onClick={goNext}>{isLast ? "Finish" : "Next question"}</Button>
            {!isLast ? (
              <Button variant="outline" onClick={() => setFinished(true)}>
                Finish now
              </Button>
            ) : null}
          </div>
        </>
      )}

      {error ? <FieldError>{error}</FieldError> : null}

      {discussion ? (
        <DialogShell
          open={discussionOpen}
          onClose={() => setDiscussionOpen(false)}
          title="Discuss this question"
        >
          <QuizDiscussion
            threadId={discussion.threadId}
            headers={buildRuntimeHeaders(code, discussion.threadToken)}
            feedback={discussion.feedback}
          />
        </DialogShell>
      ) : null}
    </div>
  );
}

// The picked photos as small thumbnails. With `onRemove` (the editing card) each
// thumbnail gets an overlaid remove button; without it (the answered card) the
// photos are display-only.
function AnswerThumbnails({
  images,
  onRemove,
  disabled = false,
}: {
  images: { name: string; dataUrl: string }[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {images.map((image, i) => (
        <div key={image.dataUrl} className="relative">
          {/* biome-ignore lint/performance/noImgElement: the src is an in-memory data URL — next/image's optimizer/loader doesn't apply. */}
          <img
            src={image.dataUrl}
            alt={image.name}
            className="h-20 w-20 rounded-lg border border-foreground/15 object-cover"
          />
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove photo ${image.name}`}
              className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-foreground/25 bg-background text-foreground/70 text-xs leading-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              onClick={() => onRemove(i)}
              disabled={disabled}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Summary({
  counts,
  answered,
  total,
}: {
  counts: VerdictCounts;
  answered: number;
  total: number;
}) {
  return (
    <div className={RUNNER}>
      <div className="flex flex-col gap-3">
        <h1 className="font-bold text-2xl">Quiz summary</h1>
        <p className={PROGRESS}>
          You answered {answered} of {total} question{total === 1 ? "" : "s"}.
        </p>
        <div className="flex flex-wrap gap-4">
          <SummaryStat verdict="correct" count={counts.correct} label="correct" />
          <SummaryStat verdict="partial" count={counts.partial} label="partly correct" />
          <SummaryStat verdict="incorrect" count={counts.incorrect} label="wrong" />
        </div>
        <p className={PROGRESS}>
          Reload the page to take the quiz again. Your answers are not stored.
        </p>
      </div>
    </div>
  );
}

function SummaryStat({
  verdict,
  count,
  label,
}: {
  verdict: QuizVerdict;
  count: number;
  label: string;
}) {
  return (
    <div
      className={cn(
        "grow basis-32 rounded-xl border border-foreground/15 border-t-(--verdict) border-t-[3px] p-4 text-center",
        VERDICT_VARS[verdict],
      )}
    >
      <span className="block font-bold text-(--verdict) text-3xl">{count}</span>
      <span className="text-foreground/55 text-sm">{label}</span>
    </div>
  );
}
