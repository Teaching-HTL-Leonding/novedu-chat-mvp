// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { EvalCheckOk } from "@/lib/eval-validate";
import { FEEDBACK_JUDGE_CRITERIA, FEEDBACK_JUDGE_SYSTEM } from "@/lib/quiz-feedback-judge";
import { TUTOR_JUDGE_CRITERIA, TUTOR_JUDGE_SYSTEM } from "@/lib/tutor-judge";
import {
  batchPassed,
  createJudgeBreaker,
  type EvalQuizCaseResult,
  type EvalRunOptions,
  type EvalRunResult,
  type EvalTutorCaseResult,
  type GradeResult,
  type JudgeFn,
  type JudgeResult,
  type RespondResult,
  runEval,
  summarizeBatch,
} from "./eval-run";

// The pure runner over a fake GradeFn: flattening, repeats, list-expect membership,
// the majority/tie rule, case-verdict totals, the confusion matrix, the false-correct
// rate, an errored case continuing, the auth abort and the circuit breaker — plus the
// FEEDBACK JUDGE layered on top: the any-repeat flag rule, judging against the repeat's
// OWN verdict, judge errors staying isolated from the case status, and the run-wide
// degrade breaker that stops judging without touching the grading half.

/** A checked eval built inline — the runner only reads these three parts. */
function checked(
  questions: { id: string; answers: { expect: unknown; answer: string }[] }[],
): EvalCheckOk {
  return {
    ok: true,
    kind: "quiz",
    llm: { provider: "SCCH", model: "test-model" },
    evalFile: {
      id: "fake-eval",
      target: "./quiz.yaml",
      questions: questions.map((q) => ({
        question: q.id,
        answers: q.answers as { expect: "correct"; answer: string }[],
      })),
    },
    targetUrl: "file:///tmp/quiz.yaml",
    quizDump: {
      kind: "quiz",
      id: "fake-quiz",
      llm: { provider: "SCCH", model: "test-model" },
      grading: {
        userMessageTemplate: "",
        userMessagePhotosOnly: "",
        responseSchema: {},
        questions: questions.map((q) => ({
          id: q.id,
          system: `system for ${q.id}`,
          imageInput: false,
        })),
      },
      discussion: {
        system: "",
        seedMessages: { question: "", answer: "", verdict: "" },
        verdictLabels: { correct: "correct", partial: "partly correct", incorrect: "wrong" },
      },
    },
    caseCount: questions.reduce((sum, q) => sum + q.answers.length, 0),
    // The question TEXTS the report needs (`loadAndCheckEval` fills these in).
    quizQuestions: questions.map((q) => ({ id: q.id, text: `text of ${q.id}` })),
    warnings: [],
  } as unknown as EvalCheckOk;
}

/**
 * The quiz runner's result, with its cases narrowed to the quiz arm — every assertion
 * below reads `expected` / `verdict` / `questionId`, which only that arm carries.
 */
type QuizRunResult = Omit<EvalRunResult, "cases" | "mismatches"> & {
  cases: EvalQuizCaseResult[];
  mismatches: EvalQuizCaseResult[];
};

async function runQuizEval(
  checkedFile: EvalCheckOk,
  options: EvalRunOptions,
): Promise<QuizRunResult> {
  return (await runEval("quiz", checkedFile, options)) as QuizRunResult;
}

const LLM = { provider: "SCCH", model: "test-model" };
const NO_SLEEP = { baseDelayMs: 0, sleep: async () => {} };

const ok = (verdict: "correct" | "partial" | "incorrect"): GradeResult => ({
  ok: true,
  verdict,
  feedback: `graded ${verdict}`,
});

/** The same, with the server's optional token report attached. */
const okWithUsage = (
  verdict: "correct" | "partial" | "incorrect",
  usage: { input: number; cachedInput: number; output: number },
): GradeResult => ({ ok: true, verdict, feedback: `graded ${verdict}`, usage });

/** A judge that finds nothing — the "this feedback is fine" answer. */
const cleanJudge: JudgeFn = async () => ({ ok: true, issues: [] });

/** A judge that always flags, so the flag plumbing is exercised deterministically. */
const flaggingJudge: JudgeFn = async () => ({
  ok: true,
  issues: [{ criterion: "ignores_instructions", note: "no correct answer stated" }],
});

describe("quiz eval runner — flattening and verdicts", () => {
  it("flattens questions × answers into cases and passes each its own grading prompt", async () => {
    const grade = vi.fn(async (_request: { system: string; answer: string }) => ok("correct"));

    const result = await runQuizEval(
      checked([
        { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
        {
          id: "q2",
          answers: [
            { expect: "correct", answer: "b" },
            { expect: "correct", answer: "c" },
          ],
        },
      ]),
      { grade, llm: LLM, retry: NO_SLEEP },
    );

    expect(result.totals).toMatchObject({ cases: 3, passed: 3, failed: 0, errored: 0, calls: 3 });
    // The evaluated questions' TEXT rides along for the Markdown report, deduped and
    // in eval-file order.
    expect(result.questions).toEqual([
      { id: "q1", text: "text of q1" },
      { id: "q2", text: "text of q2" },
    ]);
    expect(grade.mock.calls.map((call) => call[0].system)).toEqual([
      "system for q1",
      "system for q2",
      "system for q2",
    ]);
    expect(result.cases[0]).toMatchObject({ questionId: "q1", answerIndex: 0, status: "passed" });
  });

  it("accepts any member of a list expect and normalizes the set canonically", async () => {
    const grade = vi.fn(async () => ok("incorrect"));

    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: ["incorrect", "partial"], answer: "a" }] }]),
      { grade, llm: LLM, retry: NO_SLEEP },
    );

    expect(result.totals.passed).toBe(1);
    // Canonical (best → worst) regardless of the order the author wrote.
    expect(result.cases[0]?.expected).toEqual(["partial", "incorrect"]);
    expect(result.confusion).toEqual([
      { expected: "partial|incorrect", got: "incorrect", count: 1 },
    ]);
  });

  it("fails a case whose verdict is outside the expected set", async () => {
    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "incorrect", answer: "a" }] }]),
      { grade: async () => ok("correct"), llm: LLM, retry: NO_SLEEP },
    );

    expect(result.totals).toMatchObject({ passed: 0, failed: 1 });
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.verdict).toBe("correct");
  });
});

describe("quiz eval runner — repeats and the majority vote", () => {
  it("expands each case into N observations and does NOT fail on a single flaky repeat", async () => {
    const verdicts: ("correct" | "partial")[] = ["correct", "partial", "correct"];
    let call = 0;
    const grade = async () => ok(verdicts[call++] ?? "correct");

    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade, repeats: 3, llm: LLM, retry: NO_SLEEP },
    );

    expect(result.totals).toMatchObject({ cases: 1, passed: 1, failed: 0, calls: 3, repeats: 3 });
    expect(result.cases[0]?.verdict).toBe("correct");
    // Reported, never gating — this is the interesting --repeats signal.
    expect(result.totals.unstable).toBe(1);
    expect(result.cases[0]?.repeats.map((r) => r.got)).toEqual(["correct", "partial", "correct"]);
  });

  it("passes a TIE only when every tied verdict is expected", async () => {
    const alternating: ("correct" | "partial")[] = ["correct", "partial"];
    let call = 0;
    const grade = async () => ok(alternating[call++ % 2] ?? "correct");

    const both = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: ["correct", "partial"], answer: "a" }] }]),
      { grade, repeats: 2, llm: LLM, retry: NO_SLEEP },
    );
    expect(both.totals.passed).toBe(1);

    call = 0;
    const one = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade, repeats: 2, llm: LLM, retry: NO_SLEEP },
    );
    expect(one.totals.failed).toBe(1);
  });
});

describe("quiz eval runner — failure handling", () => {
  it("retries a 5xx and keeps a case that exhausts its retries as errored, run continuing", async () => {
    const grade = vi.fn(async (request: { system: string }) =>
      request.system.endsWith("q1")
        ? ({ ok: false, retryable: true, error: { message: "504" } } as GradeResult)
        : ok("correct"),
    );

    const result = await runQuizEval(
      checked([
        { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
        { id: "q2", answers: [{ expect: "correct", answer: "b" }] },
      ]),
      { grade, llm: LLM, concurrency: 1, retry: { attempts: 2, ...NO_SLEEP } },
    );

    expect(result.totals).toMatchObject({ cases: 2, passed: 1, errored: 1 });
    // 2 attempts for q1 + 1 for q2.
    expect(grade).toHaveBeenCalledTimes(3);
    expect(result.aborted).toBeUndefined();
  });

  it("never retries a terminal 4xx", async () => {
    const grade = vi.fn(
      async (): Promise<GradeResult> => ({
        ok: false,
        retryable: false,
        error: { message: "400" },
      }),
    );

    await runQuizEval(checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]), {
      grade,
      llm: LLM,
      retry: { attempts: 4, ...NO_SLEEP },
    });

    expect(grade).toHaveBeenCalledTimes(1);
  });

  it("ABORTS the whole run on an auth failure instead of erroring every case", async () => {
    const grade = vi.fn(
      async (): Promise<GradeResult> => ({
        ok: false,
        retryable: false,
        auth: true,
        error: { message: "Unauthorized" },
      }),
    );

    const result = await runQuizEval(
      checked([
        { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
        { id: "q2", answers: [{ expect: "correct", answer: "b" }] },
        { id: "q3", answers: [{ expect: "correct", answer: "c" }] },
      ]),
      { grade, llm: LLM, concurrency: 1, retry: { attempts: 4, ...NO_SLEEP } },
    );

    expect(result.aborted?.reason).toBe("auth");
    expect(grade).toHaveBeenCalledTimes(1);
    // Only the case that actually hit the auth wall is errored; the untried rest is
    // SKIPPED (empty repeats), never inflated into the errored count.
    expect(result.totals.errored).toBe(1);
    expect(result.totals.skipped).toBe(2);
    const skipped = result.cases.filter((c) => c.status === "skipped");
    expect(skipped.every((c) => c.repeats.length === 0)).toBe(true);
    // Skipped cases stay out of the mismatch listing — the abort message carries it.
    expect(result.mismatches).toHaveLength(1);
  });

  it("trips the circuit breaker after 3 consecutive fully-errored cases", async () => {
    const grade = vi.fn(
      async (): Promise<GradeResult> => ({
        ok: false,
        retryable: true,
        error: { message: "502" },
      }),
    );

    const result = await runQuizEval(
      checked([
        { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
        { id: "q2", answers: [{ expect: "correct", answer: "b" }] },
        { id: "q3", answers: [{ expect: "correct", answer: "c" }] },
        { id: "q4", answers: [{ expect: "correct", answer: "d" }] },
        { id: "q5", answers: [{ expect: "correct", answer: "e" }] },
      ]),
      { grade, llm: LLM, concurrency: 1, retry: { attempts: 2, ...NO_SLEEP } },
    );

    expect(result.aborted?.reason).toBe("circuit-breaker");
    // 3 cases × 2 attempts; q4/q5 never reach the server and are SKIPPED, not errored.
    expect(grade).toHaveBeenCalledTimes(6);
    expect(result.totals.errored).toBe(3);
    expect(result.totals.skipped).toBe(2);
  });
});

describe("quiz eval runner — report metrics", () => {
  it("computes the confusion matrix and the false-correct rate over CASE verdicts", async () => {
    const grade = vi.fn(async (request: { answer: string }) =>
      ok(request.answer === "wrong-but-accepted" ? "correct" : "incorrect"),
    );

    const result = await runQuizEval(
      checked([
        {
          id: "q1",
          answers: [
            { expect: "incorrect", answer: "wrong-but-accepted" },
            { expect: "incorrect", answer: "properly-rejected" },
            { expect: ["partial", "incorrect"], answer: "also-rejected" },
          ],
        },
      ]),
      { grade, llm: LLM, retry: NO_SLEEP },
    );

    expect(result.confusion).toEqual([
      { expected: "incorrect", got: "correct", count: 1 },
      { expected: "incorrect", got: "incorrect", count: 1 },
      { expected: "partial|incorrect", got: "incorrect", count: 1 },
    ]);
    // Denominator = every case whose expected set excludes `correct` (all three).
    expect(result.falseCorrect).toEqual({ count: 1, denominator: 3, rate: 1 / 3 });
  });

  it("records the effective llm, marking an override", async () => {
    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      {
        grade: async () => ok("correct"),
        llm: {
          provider: "Azure Foundry",
          model: "gpt-5-mini",
          overrides: { provider: "SCCH", model: "test-model" },
        },
        retry: NO_SLEEP,
      },
    );

    expect(result.llm).toEqual({
      provider: "Azure Foundry",
      model: "gpt-5-mini",
      overrides: { provider: "SCCH", model: "test-model" },
    });
  });

  it("reports live progress over grading CALLS", async () => {
    const seen: number[] = [];

    await runQuizEval(
      checked([
        { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
        { id: "q2", answers: [{ expect: "correct", answer: "b" }] },
      ]),
      {
        grade: async () => ok("correct"),
        repeats: 2,
        concurrency: 1,
        llm: LLM,
        onProgress: ({ done, total }) => {
          seen.push(done);
          expect(total).toBe(4);
        },
        retry: NO_SLEEP,
      },
    );

    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe("quiz eval runner — the feedback judge", () => {
  it("judges every graded repeat with the platform prompt, taxonomy and its OWN verdict", async () => {
    const judge = vi.fn(cleanJudge);
    const verdicts: ("correct" | "partial")[] = ["correct", "partial"];
    let call = 0;

    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: ["correct", "partial"], answer: "my answer" }] }]),
      {
        grade: async () => ok(verdicts[call++] ?? "correct"),
        judge,
        repeats: 2,
        llm: LLM,
        retry: NO_SLEEP,
      },
    );

    expect(judge).toHaveBeenCalledTimes(2);
    for (const [request] of judge.mock.calls) {
      expect(request.system).toBe(FEEDBACK_JUDGE_SYSTEM);
      expect(request.criteria).toEqual(FEEDBACK_JUDGE_CRITERIA);
      // The grading prompt, the golden answer and the feedback all reach the judge.
      expect(request.subject).toContain("system for q1");
      expect(request.subject).toContain("my answer");
    }
    // Each repeat is judged against the verdict IT got — not the case majority, which
    // would make an outvoted repeat's perfectly consistent feedback look contradictory.
    expect(judge.mock.calls[0]?.[0].subject).toContain("=== The grader's verdict ===\ncorrect");
    expect(judge.mock.calls[1]?.[0].subject).toContain("=== The grader's verdict ===\npartial");
    expect(result.judging).toBe("on");
  });

  it("flags a case when ANY repeat collected an issue — no majority vote", async () => {
    let call = 0;
    const judge: JudgeFn = async () =>
      call++ === 1
        ? { ok: true, issues: [{ criterion: "leaks_rubric", note: "quotes the rubric" }] }
        : { ok: true, issues: [] };

    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade: async () => ok("correct"), judge, repeats: 3, llm: LLM, retry: NO_SLEEP },
    );

    // One bad feedback out of three observations is exactly the --repeats signal wanted.
    expect(result.cases[0]?.feedbackFlagged).toBe(true);
    expect(result.totals.feedbackFlagged).toBe(1);
    expect(result.cases[0]?.repeats.map((row) => row.judge?.issues.length)).toEqual([0, 1, 0]);
    // …and it changes NOTHING about the verdict half of the report.
    expect(result.totals).toMatchObject({ passed: 1, failed: 0, errored: 0 });
  });

  it("records NO judge fields at all when judging is off", async () => {
    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade: async () => ok("correct"), llm: LLM, retry: NO_SLEEP },
    );

    expect(result.judging).toBe("off");
    expect(result.totals).toMatchObject({ feedbackFlagged: 0, judgeErrored: 0 });
    expect(result.cases[0]?.feedbackFlagged).toBe(false);
    expect(result.cases[0]?.repeats[0]).not.toHaveProperty("judge");
  });

  it("keeps a failed judge call OUT of the case status, retrying it like a grading", async () => {
    const judge = vi.fn(
      async (): Promise<JudgeResult> => ({
        ok: false,
        retryable: true,
        error: { message: "504 Gateway timeout" },
      }),
    );

    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      {
        grade: async () => ok("correct"),
        judge,
        llm: LLM,
        retry: { attempts: 2, ...NO_SLEEP },
      },
    );

    expect(judge).toHaveBeenCalledTimes(2); // retried like any 5xx
    // Grading succeeded, so the case PASSES — a judge outage must never fail a rubric.
    expect(result.totals).toMatchObject({ passed: 1, errored: 0, judgeErrored: 1 });
    expect(result.cases[0]?.repeats[0]?.judgeError).toBe("504 Gateway timeout");
    expect(result.cases[0]?.repeats[0]?.judge).toBeNull();
  });

  it("DEGRADES after 3 consecutive judge failures, finishing the grading half", async () => {
    const judge = vi.fn(
      async (): Promise<JudgeResult> => ({
        ok: false,
        retryable: false,
        error: { message: "502" },
      }),
    );
    const onJudgeDegraded = vi.fn();

    const result = await runQuizEval(
      checked([
        { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
        { id: "q2", answers: [{ expect: "correct", answer: "b" }] },
        { id: "q3", answers: [{ expect: "correct", answer: "c" }] },
        { id: "q4", answers: [{ expect: "correct", answer: "d" }] },
        { id: "q5", answers: [{ expect: "correct", answer: "e" }] },
      ]),
      {
        grade: async () => ok("correct"),
        judge,
        onJudgeDegraded,
        llm: LLM,
        concurrency: 1,
        retry: { attempts: 1, ...NO_SLEEP },
      },
    );

    // Judging stopped after the third failure; q4/q5 were never judged.
    expect(judge).toHaveBeenCalledTimes(3);
    expect(onJudgeDegraded).toHaveBeenCalledTimes(1);
    expect(result.judging).toBe("degraded");
    // The GRADING half is untouched — that is the whole point of degrading over aborting.
    expect(result.totals).toMatchObject({ cases: 5, passed: 5, errored: 0, skipped: 0 });
    expect(result.aborted).toBeUndefined();
    expect(result.totals.judgeErrored).toBe(3);
  });

  it("carries the degradation across the batch's remaining files", async () => {
    const judge = vi.fn(
      async (): Promise<JudgeResult> => ({
        ok: false,
        retryable: false,
        error: { message: "502" },
      }),
    );
    // The breaker is the COMMAND's, shared by every file of the run.
    const judgeBreaker = createJudgeBreaker();
    const onJudgeDegraded = vi.fn();
    const options = {
      grade: async () => ok("correct"),
      judge,
      judgeBreaker,
      onJudgeDegraded,
      llm: LLM,
      concurrency: 1,
      retry: { attempts: 1, ...NO_SLEEP },
    };
    const threeCases = checked([
      { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
      { id: "q2", answers: [{ expect: "correct", answer: "b" }] },
      { id: "q3", answers: [{ expect: "correct", answer: "c" }] },
    ]);

    const first = await runQuizEval(threeCases, options);
    const second = await runQuizEval(threeCases, options);

    expect(first.judging).toBe("degraded");
    // The SECOND file made no judge call at all — a down judge stops costing calls for
    // the rest of the run, not once per file — and it says so rather than reporting "on".
    expect(judge).toHaveBeenCalledTimes(3);
    expect(onJudgeDegraded).toHaveBeenCalledTimes(1);
    expect(second.judging).toBe("degraded");
    expect(second.totals).toMatchObject({ passed: 3, feedbackFlagged: 0, judgeErrored: 0 });
  });

  it("sums judge tokens into the SAME usage bucket as the gradings", async () => {
    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      {
        grade: async () => okWithUsage("correct", { input: 100, cachedInput: 40, output: 7 }),
        judge: async () => ({
          ok: true,
          issues: [],
          usage: { input: 20, cachedInput: 5, output: 3 },
        }),
        llm: LLM,
        retry: NO_SLEEP,
      },
    );

    // One eval run is one cost — there is deliberately no separate judge bucket.
    expect(result.totals.usage).toEqual({ input: 120, cachedInput: 45, output: 10 });
    expect(result.cases[0]?.repeats[0]?.judge?.usage).toEqual({
      input: 20,
      cachedInput: 5,
      output: 3,
    });
  });

  it("never judges a repeat that produced no verdict, and still marks it unjudged", async () => {
    const judge = vi.fn(cleanJudge);

    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      {
        grade: async (): Promise<GradeResult> => ({
          ok: false,
          retryable: false,
          error: { message: "400" },
        }),
        judge,
        llm: LLM,
        retry: { attempts: 1, ...NO_SLEEP },
      },
    );

    expect(judge).not.toHaveBeenCalled();
    // ONE convention for a judged run: every repeat carries `judge`, and `null` means
    // "no judgment" — so `judge === null` catches an errored grading too, not only a
    // degraded one.
    expect(result.cases[0]?.repeats[0]).toHaveProperty("judge", null);
    expect(result.totals.judgeErrored).toBe(0);
  });

  it("abandons a judge call's remaining retries when the breaker trips mid-backoff", async () => {
    // The real concurrent scenario: this call is waiting out its backoff when OTHER cases
    // finish failing and trip the shared breaker. Its remaining attempts would otherwise
    // burn the full budget against a judge the run has already given up on, so `sleep`
    // here stands in for those other workers.
    const judge = vi.fn(
      async (): Promise<JudgeResult> => ({ ok: false, retryable: true, error: { message: "504" } }),
    );
    const judgeBreaker = createJudgeBreaker();

    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      {
        grade: async () => ok("correct"),
        judge,
        judgeBreaker,
        llm: LLM,
        retry: {
          attempts: 4,
          baseDelayMs: 0,
          sleep: async () => {
            judgeBreaker.stopped = true;
          },
        },
      },
    );

    // The breaker tripped during the first backoff, so attempt 2 is the last one the
    // call makes: two attempts instead of the full four.
    expect(judge).toHaveBeenCalledTimes(2);
    expect(result.cases[0]?.repeats[0]?.judgeError).toBe("504");
  });

  it("ticks progress only once a repeat's judge call is done, never before", async () => {
    // The counter must not read "M/M" while minutes of judging are still to come.
    const seen: string[] = [];

    await runQuizEval(checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]), {
      grade: async () => ok("correct"),
      judge: async () => {
        seen.push("judge");
        return { ok: true, issues: [] };
      },
      onProgress: () => seen.push("progress"),
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(seen).toEqual(["judge", "progress"]);
  });

  it("does not gate: a flagged file still passes the CI gate", async () => {
    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade: async () => ok("correct"), judge: flaggingJudge, llm: LLM, retry: NO_SLEEP },
    );

    const batch = summarizeBatch([{ source: "file:///a.yaml", status: "ok", result }]);
    expect(batch.totals.feedbackFlagged).toBe(1);
    expect(batch.passed).toBe(true);
    expect(batchPassed(batch)).toBe(true);
    expect(batch.files[0]?.passed).toBe(true);
  });
});

describe("summarizeBatch", () => {
  it("sums graded totals and counts invalid files", async () => {
    const result = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade: async () => ok("correct"), llm: LLM, retry: NO_SLEEP },
    );

    const batch = summarizeBatch([
      { source: "file:///a.yaml", status: "ok", result },
      {
        source: "file:///b.yaml",
        status: "invalid",
        errors: [{ code: "EVAL_SCHEMA", message: "x" }],
      },
    ]);

    expect(batch.totals).toEqual({
      files: 2,
      invalid: 1,
      cases: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      skipped: 0,
      unstable: 0,
      feedbackFlagged: 0,
      toolsFlagged: 0,
      judgeErrored: 0,
      usage: { input: 0, cachedInput: 0, output: 0 },
    });
  });

  it("stamps the CI verdict on the batch and on every file", async () => {
    const green = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade: async () => ok("correct"), llm: LLM, retry: NO_SLEEP },
    );
    const red = await runQuizEval(
      checked([{ id: "q2", answers: [{ expect: "incorrect", answer: "b" }] }]),
      { grade: async () => ok("correct"), llm: LLM, retry: NO_SLEEP },
    );

    const clean = summarizeBatch([{ source: "file:///a.yaml", status: "ok", result: green }]);
    expect(clean.passed).toBe(true);
    expect(clean.files[0]?.passed).toBe(true);
    // Exactly the exit-code rule — never a second implementation of it.
    expect(clean.passed).toBe(batchPassed(clean));

    const mixed = summarizeBatch([
      { source: "file:///a.yaml", status: "ok", result: green },
      { source: "file:///b.yaml", status: "ok", result: red },
      {
        source: "file:///c.yaml",
        status: "invalid",
        errors: [{ code: "EVAL_SCHEMA", message: "x" }],
      },
    ]);
    expect(mixed.passed).toBe(false);
    expect(mixed.files.map((file) => file.passed)).toEqual([true, false, false]);
  });

  it("sums token usage across files and tolerates calls that reported none", async () => {
    let call = 0;
    const withUsage = await runQuizEval(
      checked([
        { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
        { id: "q2", answers: [{ expect: "correct", answer: "b" }] },
      ]),
      {
        // The second call reports NO usage — a server without the field must simply
        // contribute nothing rather than break the aggregation.
        grade: async () =>
          call++ === 0
            ? okWithUsage("correct", { input: 100, cachedInput: 40, output: 7 })
            : ok("correct"),
        llm: LLM,
        concurrency: 1,
        retry: NO_SLEEP,
      },
    );

    expect(withUsage.totals.usage).toEqual({ input: 100, cachedInput: 40, output: 7 });
    // Per-call detail lives on the repeat rows.
    expect(withUsage.cases[0]?.repeats[0]?.usage).toEqual({
      input: 100,
      cachedInput: 40,
      output: 7,
    });
    expect(withUsage.cases[1]?.repeats[0]?.usage).toBeUndefined();

    const noUsage = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade: async () => ok("correct"), llm: LLM, retry: NO_SLEEP },
    );
    // Always present, zeroed — "nothing reported" is not "zero tokens", and the
    // renderers read the zeros as "print no token line".
    expect(noUsage.totals.usage).toEqual({ input: 0, cachedInput: 0, output: 0 });

    const batch = summarizeBatch([
      { source: "file:///a.yaml", status: "ok", result: withUsage },
      { source: "file:///b.yaml", status: "ok", result: noUsage },
    ]);
    expect(batch.totals.usage).toEqual({ input: 100, cachedInput: 40, output: 7 });
  });

  it("fails the CI gate on skipped cases — an aborted run is never a pass", async () => {
    const result = await runQuizEval(
      checked([
        { id: "q1", answers: [{ expect: "correct", answer: "a" }] },
        { id: "q2", answers: [{ expect: "correct", answer: "b" }] },
      ]),
      {
        grade: async (): Promise<GradeResult> => ({
          ok: false,
          retryable: false,
          auth: true,
          error: { message: "Unauthorized" },
        }),
        llm: LLM,
        concurrency: 1,
        retry: { attempts: 1, ...NO_SLEEP },
      },
    );

    const batch = summarizeBatch([{ source: "file:///a.yaml", status: "ok", result }]);
    expect(batch.totals.skipped).toBe(1);
    expect(batchPassed(batch)).toBe(false);
  });
});

// --- the TUTOR runner ---------------------------------------------------------------
// Same machinery, a different pair of calls per repeat: one generated turn, then the judge
// over THAT repeat's own response. No verdict, so no majority, no confusion matrix, no
// `unstable` — and the judge REPORTS without ever gating (the tutor kind's whole policy).

/** A checked tutor eval built inline — the runner only reads these parts. */
function checkedTutor(
  conversations: {
    title?: string;
    grading_instructions?: string;
    required_tools?: string[];
    conversation: ({ student: string } | { tutor: string })[];
  }[],
  tools: string[] = [],
): EvalCheckOk {
  return {
    ok: true,
    kind: "tutor",
    llm: { provider: "SCCH", model: "test-model" },
    evalFile: { id: "fake-tutor-eval", kind: "tutor", target: "./tutor.yaml", conversations },
    targetUrl: "file:///tmp/tutor.yaml",
    tutorDump: {
      kind: "tutor",
      id: "fake-tutor",
      llm: { provider: "SCCH", model: "test-model" },
      system: "TUTOR-SYSTEM",
      tools,
    },
    caseCount: conversations.length,
    warnings: [],
  } as unknown as EvalCheckOk;
}

type TutorRunResult = Omit<EvalRunResult, "cases" | "mismatches"> & {
  cases: EvalTutorCaseResult[];
  mismatches: EvalTutorCaseResult[];
};

async function runTutorEval(
  checkedFile: EvalCheckOk,
  options: EvalRunOptions,
): Promise<TutorRunResult> {
  return (await runEval("tutor", checkedFile, options)) as TutorRunResult;
}

const ONE_CASE = [
  {
    title: "refuses-full-solution",
    grading_instructions: "Never hand over the loop.",
    conversation: [{ student: "Just fix it for me!" }],
  },
];

const respondOk = (text = "What does your condition evaluate to?"): RespondResult => ({
  ok: true,
  text,
});

describe("tutor eval runner — generation", () => {
  it("makes ONE generation call per conversation, carrying the tutor's prompt and tools", async () => {
    const respond = vi.fn(
      async (_request: {
        system: string;
        tools: readonly string[];
        messages: readonly { role: string; text: string }[];
      }) => respondOk(),
    );

    const result = await runTutorEval(
      checkedTutor(
        [
          { conversation: [{ student: "a" }] },
          {
            conversation: [{ student: "b" }, { tutor: "hm?" }, { student: "c" }],
          },
        ],
        ["random_number"],
      ),
      { respond, llm: LLM, retry: NO_SLEEP },
    );

    expect(result.kind).toBe("tutor");
    expect(result.totals).toMatchObject({ cases: 2, errored: 0, skipped: 0, calls: 2 });
    // Quiz-only metrics stay zero/empty rather than pretending to mean something.
    expect(result.totals).toMatchObject({ passed: 0, failed: 0, unstable: 0 });
    expect(result.confusion).toEqual([]);
    expect(result.questions).toEqual([]);
    expect(result.falseCorrect).toEqual({ count: 0, denominator: 0, rate: 0 });

    expect(respond).toHaveBeenCalledTimes(2);
    const [first, second] = respond.mock.calls.map((call) => call[0]);
    expect(first?.system).toBe("TUTOR-SYSTEM");
    expect(first?.tools).toEqual(["random_number"]);
    // `student`/`tutor` become `user`/`assistant`, in order, ending on the student turn.
    expect(second?.messages).toEqual([
      { role: "user", text: "b" },
      { role: "assistant", text: "hm?" },
      { role: "user", text: "c" },
    ]);
    expect(result.cases[0]).toMatchObject({ index: 0, status: "ok", unstable: false });
    expect(result.cases[0]?.repeats[0]?.text).toBe("What does your condition evaluate to?");
  });

  it("keeps the case's title, conversation and expectations on the result", async () => {
    const result = await runTutorEval(checkedTutor(ONE_CASE), {
      respond: async () => respondOk(),
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(result.cases[0]).toMatchObject({
      title: "refuses-full-solution",
      gradingInstructions: "Never hand over the loop.",
      conversation: [{ student: "Just fix it for me!" }],
    });
  });

  it("errors a case whose generation exhausts its retries, and continues", async () => {
    let call = 0;
    const respond = async (): Promise<RespondResult> =>
      call++ === 0
        ? { ok: false, retryable: false, error: { message: "boom" } }
        : respondOk("fine");

    const result = await runTutorEval(
      checkedTutor([{ conversation: [{ student: "a" }] }, { conversation: [{ student: "b" }] }]),
      { respond, llm: LLM, concurrency: 1, retry: { attempts: 1, ...NO_SLEEP } },
    );

    expect(result.totals).toMatchObject({ cases: 2, errored: 1 });
    expect(result.cases[0]?.status).toBe("errored");
    expect(result.cases[1]?.status).toBe("ok");
    // Errored cases ARE the tutor kind's "mismatches" — what the human report lists.
    expect(result.mismatches).toHaveLength(1);
  });

  it("aborts on auth and reports the untouched conversations as skipped", async () => {
    const result = await runTutorEval(
      checkedTutor([{ conversation: [{ student: "a" }] }, { conversation: [{ student: "b" }] }]),
      {
        respond: async (): Promise<RespondResult> => ({
          ok: false,
          retryable: false,
          auth: true,
          error: { message: "Unauthorized" },
        }),
        llm: LLM,
        concurrency: 1,
        retry: { attempts: 1, ...NO_SLEEP },
      },
    );

    expect(result.aborted?.reason).toBe("auth");
    expect(result.totals).toMatchObject({ errored: 1, skipped: 1 });
    // An incomplete run must never read as a pass.
    expect(batchPassed(summarizeBatch([{ source: "f", status: "ok", result }]))).toBe(false);
  });

  it("trips the circuit breaker after 3 consecutive errored conversations", async () => {
    const result = await runTutorEval(
      checkedTutor(Array.from({ length: 6 }, (_, i) => ({ conversation: [{ student: `q${i}` }] }))),
      {
        respond: async (): Promise<RespondResult> => ({
          ok: false,
          retryable: false,
          error: { message: "down" },
        }),
        llm: LLM,
        concurrency: 1,
        retry: { attempts: 1, ...NO_SLEEP },
      },
    );

    expect(result.aborted?.reason).toBe("circuit-breaker");
    expect(result.totals.errored).toBe(3);
    expect(result.totals.skipped).toBe(3);
  });
});

describe("tutor eval runner — the judge", () => {
  it("judges THIS repeat's own response against the tutor prompt and the expectations", async () => {
    const judge = vi.fn(cleanJudge);

    await runTutorEval(checkedTutor(ONE_CASE), {
      respond: async () => respondOk("Here is the whole loop."),
      judge,
      llm: LLM,
      retry: NO_SLEEP,
    });

    const request = judge.mock.calls[0]?.[0];
    expect(request?.system).toBe(TUTOR_JUDGE_SYSTEM);
    expect(request?.subject).toContain("TUTOR-SYSTEM");
    expect(request?.subject).toContain("student: Just fix it for me!");
    expect(request?.subject).toContain("Here is the whole loop.");
    expect(request?.subject).toContain("Never hand over the loop.");
    expect(request?.criteria).toEqual([...TUTOR_JUDGE_CRITERIA]);
  });

  it("drops fails_expectations for a case that states no expectations", async () => {
    const judge = vi.fn(cleanJudge);

    await runTutorEval(checkedTutor([{ conversation: [{ student: "a" }] }]), {
      respond: async () => respondOk(),
      judge,
      llm: LLM,
      retry: NO_SLEEP,
    });

    const request = judge.mock.calls[0]?.[0];
    expect(request?.criteria).not.toContain("fails_expectations");
    expect(request?.subject).not.toContain("expectations");
  });

  it("flags a case when ANY repeat collects an issue — and NEVER gates on it", async () => {
    let call = 0;
    const judge: JudgeFn = async () =>
      call++ === 1
        ? { ok: true, issues: [{ criterion: "ignores_instructions", note: "solved it" }] }
        : { ok: true, issues: [] };

    const result = await runTutorEval(checkedTutor(ONE_CASE), {
      respond: async () => respondOk(),
      judge,
      repeats: 3,
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(result.totals.feedbackFlagged).toBe(1);
    expect(result.cases[0]?.feedbackFlagged).toBe(true);
    // Report-only: the case still counts as `ok` and the run still passes the CI gate.
    expect(result.cases[0]?.status).toBe("ok");
    expect(result.totals.errored).toBe(0);
    expect(batchPassed(summarizeBatch([{ source: "f", status: "ok", result }]))).toBe(true);
  });

  it("records a failed judge call as judgeError without erroring the case", async () => {
    const result = await runTutorEval(checkedTutor(ONE_CASE), {
      respond: async () => respondOk(),
      judge: async (): Promise<JudgeResult> => ({
        ok: false,
        retryable: false,
        error: { message: "judge down" },
      }),
      llm: LLM,
      retry: { attempts: 1, ...NO_SLEEP },
    });

    expect(result.cases[0]?.status).toBe("ok");
    expect(result.cases[0]?.repeats[0]?.judgeError).toContain("judge down");
    expect(result.cases[0]?.repeats[0]?.judge).toBeNull();
    expect(result.totals.judgeErrored).toBe(1);
  });

  it("DEGRADES judging after 3 consecutive judge failures, leaving generation untouched", async () => {
    const onJudgeDegraded = vi.fn();
    const breaker = createJudgeBreaker();

    const result = await runTutorEval(
      checkedTutor(Array.from({ length: 5 }, (_, i) => ({ conversation: [{ student: `q${i}` }] }))),
      {
        respond: async () => respondOk(),
        judge: async (): Promise<JudgeResult> => ({
          ok: false,
          retryable: false,
          error: { message: "judge down" },
        }),
        judgeBreaker: breaker,
        onJudgeDegraded,
        llm: LLM,
        concurrency: 1,
        retry: { attempts: 1, ...NO_SLEEP },
      },
    );

    expect(onJudgeDegraded).toHaveBeenCalledTimes(1);
    expect(result.judging).toBe("degraded");
    // Every conversation still generated its response.
    expect(result.totals.errored).toBe(0);
    expect(result.totals.judgeErrored).toBe(3);
  });

  it("records judging: off and carries no judge fields at all", async () => {
    const result = await runTutorEval(checkedTutor(ONE_CASE), {
      respond: async () => respondOk(),
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(result.judging).toBe("off");
    expect(result.cases[0]?.repeats[0]).not.toHaveProperty("judge");
    expect(result.totals.feedbackFlagged).toBe(0);
  });

  it("sums generation AND judge tokens into one bucket", async () => {
    const result = await runTutorEval(checkedTutor(ONE_CASE), {
      respond: async (): Promise<RespondResult> => ({
        ok: true,
        text: "hi",
        usage: { input: 100, cachedInput: 40, output: 7 },
      }),
      judge: async (): Promise<JudgeResult> => ({
        ok: true,
        issues: [],
        usage: { input: 10, cachedInput: 2, output: 1 },
      }),
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(result.totals.usage).toEqual({ input: 110, cachedInput: 42, output: 8 });
  });
});

// A case that requires tools, and a seam that reports exactly what ran.
const TOOL_CASE = [
  {
    title: "draws-a-random-problem",
    required_tools: ["random_number"],
    conversation: [{ student: "Give me a practice problem." }],
  },
];

const respondWithTools = (toolCalls: string[]): RespondResult => ({
  ok: true,
  text: "Convert 42 to binary.",
  toolCalls,
});

describe("tutor eval runner — required_tools", () => {
  it("records the calls and an EMPTY missing list when every required tool ran", async () => {
    const result = await runTutorEval(checkedTutor(TOOL_CASE, ["random_number"]), {
      respond: async () => respondWithTools(["random_number"]),
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(result.cases[0]).toMatchObject({
      status: "ok",
      requiredTools: ["random_number"],
      toolsFlagged: false,
    });
    // Present and empty: a real measurement, not a missing key.
    expect(result.cases[0]?.repeats[0]?.missingTools).toEqual([]);
    expect(result.cases[0]?.repeats[0]?.toolCalls).toEqual(["random_number"]);
    expect(result.totals.toolsFlagged).toBe(0);
  });

  it("flags a MISSING tool on ANY repeat without touching the status or the gate", async () => {
    let call = 0;
    const respond = async (): Promise<RespondResult> =>
      call++ === 1 ? respondWithTools([]) : respondWithTools(["random_number"]);

    const result = await runTutorEval(checkedTutor(TOOL_CASE, ["random_number"]), {
      respond,
      repeats: 3,
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(result.cases[0]?.toolsFlagged).toBe(true);
    expect(result.cases[0]?.repeats.map((row) => row.missingTools)).toEqual([
      [],
      ["random_number"],
      [],
    ]);
    expect(result.totals.toolsFlagged).toBe(1);
    // REPORT-ONLY, exactly like a judge flag: the case is still `ok` and the run passes.
    expect(result.cases[0]?.status).toBe("ok");
    expect(result.totals.errored).toBe(0);
    expect(batchPassed(summarizeBatch([{ source: "f", status: "ok", result }]))).toBe(true);
  });

  it("never minds EXTRA tools, and records no missing list for a case requiring none", async () => {
    const result = await runTutorEval(
      checkedTutor([...TOOL_CASE, { conversation: [{ student: "hi" }] }], ["random_number"]),
      {
        respond: async () => respondWithTools(["random_number", "random_number"]),
        llm: LLM,
        concurrency: 1,
        retry: NO_SLEEP,
      },
    );

    // A tool called twice, plus nothing required of the second case at all.
    expect(result.cases[0]?.toolsFlagged).toBe(false);
    expect(result.cases[0]?.repeats[0]?.missingTools).toEqual([]);
    expect(result.cases[1]).not.toHaveProperty("requiredTools");
    expect(result.cases[1]?.repeats[0]).not.toHaveProperty("missingTools");
    expect(result.totals.toolsFlagged).toBe(0);
  });

  it("ERRORS a required-tools case when the server reports no tool calls at all", async () => {
    // A new CLI against an old server: reporting "nothing missing" would certify a check
    // that never ran, so this is run health — loud, terminal, and it names the fix.
    const respond = vi.fn(async (): Promise<RespondResult> => ({ ok: true, text: "sure" }));

    const result = await runTutorEval(checkedTutor(TOOL_CASE, ["random_number"]), {
      respond,
      repeats: 2,
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(result.cases[0]?.status).toBe("errored");
    const failure = result.cases[0]?.repeats[0]?.error as { message?: string } | undefined;
    expect(failure?.message).toContain("too old to report them");
    // Terminal: the remaining repeats are not attempted, and nothing was retried.
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.totals.toolsFlagged).toBe(0);
    expect(batchPassed(summarizeBatch([{ source: "f", status: "ok", result }]))).toBe(false);
  });

  it("leaves a case that requires nothing untouched on such a server", async () => {
    const result = await runTutorEval(checkedTutor([{ conversation: [{ student: "hi" }] }]), {
      respond: async (): Promise<RespondResult> => ({ ok: true, text: "sure" }),
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(result.cases[0]?.status).toBe("ok");
    expect(result.totals.errored).toBe(0);
  });

  it("hands the judge the tool calls as evidence when the tutor has a grant", async () => {
    const judge = vi.fn(cleanJudge);

    await runTutorEval(checkedTutor(TOOL_CASE, ["random_number"]), {
      respond: async () => respondWithTools(["random_number"]),
      judge,
      llm: LLM,
      retry: NO_SLEEP,
    });

    expect(judge.mock.calls[0]?.[0].subject).toContain("Tools the tutor called while answering");
    // The deterministic check owns tool PRESENCE — the taxonomy is unchanged.
    expect(judge.mock.calls[0]?.[0].criteria).not.toContain("missing_tools");
  });

  it("sums toolsFlagged across a batch", async () => {
    const flagged = await runTutorEval(checkedTutor(TOOL_CASE, ["random_number"]), {
      respond: async () => respondWithTools([]),
      llm: LLM,
      retry: NO_SLEEP,
    });
    const clean = await runTutorEval(checkedTutor(TOOL_CASE, ["random_number"]), {
      respond: async () => respondWithTools(["random_number"]),
      llm: LLM,
      retry: NO_SLEEP,
    });

    const batch = summarizeBatch([
      { source: "file:///a.eval.yaml", status: "ok", result: flagged },
      { source: "file:///b.eval.yaml", status: "ok", result: clean },
    ]);

    expect(batch.totals.toolsFlagged).toBe(1);
    // Never a gate — the batch still passes.
    expect(batch.passed).toBe(true);
  });
});

describe("mixed batches", () => {
  it("summarizes a quiz and a tutor file into ONE shape, stamping each file's kind", async () => {
    const quiz = await runQuizEval(
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade: async () => ok("correct"), judge: flaggingJudge, llm: LLM, retry: NO_SLEEP },
    );
    const tutor = await runTutorEval(checkedTutor(ONE_CASE), {
      respond: async () => respondOk(),
      judge: flaggingJudge,
      llm: LLM,
      retry: NO_SLEEP,
    });

    const batch = summarizeBatch([
      { source: "file:///a.eval.yaml", status: "ok", result: quiz },
      { source: "file:///b.eval.yaml", status: "ok", result: tutor },
      { source: "file:///c.eval.yaml", status: "invalid", errors: [] },
    ]);

    expect(batch.files.map((file) => file.kind)).toEqual(["quiz", "tutor", undefined]);
    expect(batch.totals).toMatchObject({ files: 3, invalid: 1, cases: 2, feedbackFlagged: 2 });
    // The invalid file is what fails the gate — the two flags never do.
    expect(batch.passed).toBe(false);
  });
});
