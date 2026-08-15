// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { EvalCheckOk } from "@/lib/eval-validate";
import { FEEDBACK_JUDGE_CRITERIA, FEEDBACK_JUDGE_SYSTEM } from "@/lib/quiz-feedback-judge";
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
