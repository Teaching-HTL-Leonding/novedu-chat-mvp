"use client";

import { useEffect, useRef, useState } from "react";
import { ContentImage } from "@/components/content-image";
import { startDiscussion, submitAnswer } from "@/lib/quiz-actions";
import {
  type QuizVerdict,
  type ResolvedQuiz,
  type ResolvedQuizQuestion,
  verdictLabel,
} from "@/lib/quiz-types";
import { buildRuntimeHeaders } from "@/lib/runtime-headers";
import { MarkdownRenderer } from "../../markdown-renderer";
import { QuizDiscussion } from "./quiz-discussion";
import styles from "./quiz-runner.module.css";

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
  // The discussion lives in a modal <dialog> overlaying the page. `discussionOpen`
  // drives showModal()/close() via the effect below; closing keeps the thread so
  // the student can reopen it ("Continue discussion") until they move on.
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (discussionOpen && !dialog.open) dialog.showModal();
    else if (!discussionOpen && dialog.open) dialog.close();
  }, [discussionOpen]);

  if (!ready) {
    return (
      <div className={styles.runner}>
        <p className={styles.progress}>Preparing quiz…</p>
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
    // Close the modal before unmounting it, then drop the thread for this question.
    dialogRef.current?.close();
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
    <div className={styles.runner}>
      {quiz.title || quiz.description ? (
        <header>
          {quiz.title ? <h1>{quiz.title}</h1> : null}
          {quiz.description ? (
            <div className={styles.questionBody}>
              <MarkdownRenderer content={quiz.description} />
            </div>
          ) : null}
        </header>
      ) : null}

      <p className={styles.progress}>
        Question {index + 1} of {total}
      </p>

      <section className={styles.card}>
        {current.title ? <h2 className={styles.questionTitle}>{current.title}</h2> : null}
        {current.image ? <ContentImage image={current.image} /> : null}
        <div className={styles.questionBody}>
          <MarkdownRenderer content={current.question} />
        </div>
      </section>

      {!verdict ? (
        <section className={styles.card}>
          <label className={styles.label} htmlFor="quiz-answer">
            Your answer
          </label>
          <textarea
            id="quiz-answer"
            className={styles.answerArea}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={grading}
            placeholder="Type your answer…"
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => handleSubmit(current)}
              disabled={grading || answer.trim() === ""}
            >
              {grading ? "Checking…" : "Submit answer"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setFinished(true)}
              disabled={grading}
            >
              Finish
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className={styles.card}>
            <span className={styles.label}>Your answer</span>
            <p className={styles.submittedAnswer}>{answer}</p>
          </section>
          <section className={`${styles.card} ${styles.verdictCard} ${styles[verdict.result]}`}>
            <h3 className={styles.verdictHeading}>{verdictLabel(verdict.result)}</h3>
            <div className={styles.feedback}>
              <MarkdownRenderer content={verdict.feedback} />
            </div>
          </section>
          <div className={styles.actions}>
            {!discussion ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => handleOpenDiscussion(current)}
                disabled={openingDiscussion}
              >
                {openingDiscussion ? "Opening…" : "Chat about this"}
              </button>
            ) : (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setDiscussionOpen(true)}
              >
                Continue discussion
              </button>
            )}
            <button type="button" className={styles.button} onClick={goNext}>
              {isLast ? "Finish" : "Next question"}
            </button>
            {!isLast ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setFinished(true)}
              >
                Finish now
              </button>
            ) : null}
          </div>
        </>
      )}

      {error ? <p className={styles.error}>{error}</p> : null}

      {discussion ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is mouse-only; the native <dialog> already closes on Escape (onClose), and a Close button covers keyboard users.
        <dialog
          ref={dialogRef}
          className={styles.dialog}
          onClose={() => setDiscussionOpen(false)}
          // Clicking the backdrop (the dialog element itself, not its content) closes it.
          onClick={(event) => {
            if (event.target === dialogRef.current) setDiscussionOpen(false);
          }}
        >
          <div className={styles.dialogInner}>
            <div className={styles.dialogHeader}>
              <h3 className={styles.discussionHeading}>Discuss this question</h3>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setDiscussionOpen(false)}
              >
                Close
              </button>
            </div>
            <QuizDiscussion
              threadId={discussion.threadId}
              headers={buildRuntimeHeaders(code, discussion.threadToken)}
              feedback={discussion.feedback}
            />
          </div>
        </dialog>
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
    <div className={styles.runner}>
      <div className={styles.summary}>
        <h1>Quiz summary</h1>
        <p className={styles.progress}>
          You answered {answered} of {total} question{total === 1 ? "" : "s"}.
        </p>
        <div className={styles.summaryCounts}>
          <div className={`${styles.summaryStat} ${styles.correct}`}>
            <span className={styles.summaryNumber}>{counts.correct}</span>
            <span className={styles.summaryLabel}>correct</span>
          </div>
          <div className={`${styles.summaryStat} ${styles.partial}`}>
            <span className={styles.summaryNumber}>{counts.partial}</span>
            <span className={styles.summaryLabel}>partly correct</span>
          </div>
          <div className={`${styles.summaryStat} ${styles.incorrect}`}>
            <span className={styles.summaryNumber}>{counts.incorrect}</span>
            <span className={styles.summaryLabel}>wrong</span>
          </div>
        </div>
        <p className={styles.progress}>
          Reload the page to take the quiz again. Your answers are not stored.
        </p>
      </div>
    </div>
  );
}
