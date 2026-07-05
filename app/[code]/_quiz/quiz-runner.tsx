"use client";

import { useEffect, useState } from "react";
import { ContentImage } from "@/components/content-image";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { FieldError } from "@/components/ui/field";
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

  async function handleSubmit(question: ResolvedQuizQuestion) {
    const trimmed = answer.trim();
    if (!trimmed || grading) return;
    setGrading(true);
    setError(null);
    const res = await submitAnswer({ code, questionId: question.id, answer: trimmed });
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
          <div className={ACTIONS}>
            <Button
              onClick={() => handleSubmit(current)}
              disabled={grading || answer.trim() === ""}
            >
              {grading ? "Checking…" : "Submit answer"}
            </Button>
            <Button variant="outline" onClick={() => setFinished(true)} disabled={grading}>
              Finish
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section className={CARD}>
            <span className={LABEL}>Your answer</span>
            <p className="whitespace-pre-wrap leading-relaxed">{answer}</p>
          </section>
          <section
            className={cn(CARD, "border-l-(--verdict) border-l-4", VERDICT_VARS[verdict.result])}
          >
            <h3 className="mb-2 font-bold text-(--verdict) text-base capitalize">
              {verdictLabel(verdict.result)}
            </h3>
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
