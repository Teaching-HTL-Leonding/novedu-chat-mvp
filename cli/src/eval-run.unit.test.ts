// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { EvalCheckOk } from "@/lib/eval-validate";
import { batchPassed, type GradeResult, runEval, summarizeBatch } from "./eval-run";

// The pure runner over a fake GradeFn: flattening, repeats, list-expect membership,
// the majority/tie rule, case-verdict totals, the confusion matrix, the false-correct
// rate, an errored case continuing, the auth abort and the circuit breaker.

/** A checked eval built inline — the runner only reads these three parts. */
function checked(
  questions: { id: string; answers: { expect: unknown; answer: string }[] }[],
): EvalCheckOk {
  return {
    ok: true,
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

describe("quiz eval runner — flattening and verdicts", () => {
  it("flattens questions × answers into cases and passes each its own grading prompt", async () => {
    const grade = vi.fn(async (_request: { system: string; answer: string }) => ok("correct"));

    const result = await runEval(
      "quiz",
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

    const result = await runEval(
      "quiz",
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
    const result = await runEval(
      "quiz",
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

    const result = await runEval(
      "quiz",
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

    const both = await runEval(
      "quiz",
      checked([{ id: "q1", answers: [{ expect: ["correct", "partial"], answer: "a" }] }]),
      { grade, repeats: 2, llm: LLM, retry: NO_SLEEP },
    );
    expect(both.totals.passed).toBe(1);

    call = 0;
    const one = await runEval(
      "quiz",
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

    const result = await runEval(
      "quiz",
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

    await runEval("quiz", checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]), {
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

    const result = await runEval(
      "quiz",
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

    const result = await runEval(
      "quiz",
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

    const result = await runEval(
      "quiz",
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
    const result = await runEval(
      "quiz",
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

    await runEval(
      "quiz",
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

describe("summarizeBatch", () => {
  it("sums graded totals and counts invalid files", async () => {
    const result = await runEval(
      "quiz",
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
      usage: { input: 0, cachedInput: 0, output: 0 },
    });
  });

  it("stamps the CI verdict on the batch and on every file", async () => {
    const green = await runEval(
      "quiz",
      checked([{ id: "q1", answers: [{ expect: "correct", answer: "a" }] }]),
      { grade: async () => ok("correct"), llm: LLM, retry: NO_SLEEP },
    );
    const red = await runEval(
      "quiz",
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
    const withUsage = await runEval(
      "quiz",
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

    const noUsage = await runEval(
      "quiz",
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
    const result = await runEval(
      "quiz",
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
