import { beforeEach, describe, expect, it, vi } from "vitest";
import { gradeWithTruncationRetry } from "@/lib/quiz-truncation-retry";

// The shared issue-#115 retry (`lib/quiz-truncation-retry.ts`): the detector itself is
// covered in `lib/quiz-feedback-truncation.unit.test.ts`; what is asserted here is the
// retry policy — one extra sample on a truncated feedback, the first verdict never lost
// to a failing retry, and the telemetry event only when the SERVED feedback is still
// truncated.

const emitEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telemetry", () => ({ emitEvent }));

const CLEAN = { result: "correct" as const, feedback: "Well done." };
const TRUNCATED = { result: "correct" as const, feedback: "Use `lightblue" };

/** A grade fn serving one canned attempt per call; `raw` carries the attempt index. */
function gradeSequence(...objects: Array<typeof CLEAN | undefined>) {
  let call = 0;
  return {
    grade: vi.fn(async () => {
      call += 1;
      return { attempt: call, object: objects[call - 1] };
    }),
  };
}

const objectOf = (raw: { object?: typeof CLEAN }) => raw.object;

beforeEach(() => {
  emitEvent.mockClear();
});

describe("gradeWithTruncationRetry", () => {
  it("grades once and stays silent when the feedback is clean", async () => {
    const { grade } = gradeSequence(CLEAN);

    const { raw, object } = await gradeWithTruncationRetry(grade, objectOf);

    expect(grade).toHaveBeenCalledTimes(1);
    expect(object).toEqual(CLEAN);
    expect(raw.attempt).toBe(1);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("serves the retry when it lands clean, raw attempt included", async () => {
    const { grade } = gradeSequence(TRUNCATED, CLEAN);

    const { raw, object } = await gradeWithTruncationRetry(grade, objectOf);

    expect(grade).toHaveBeenCalledTimes(2);
    expect(object).toEqual(CLEAN);
    // The served raw result is the retry's — the eval route reads its usage off it.
    expect(raw.attempt).toBe(2);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("serves a still-truncated retry and emits the event with the caller's payload", async () => {
    const { grade } = gradeSequence(TRUNCATED, TRUNCATED);

    const { object } = await gradeWithTruncationRetry(grade, objectOf, { code: "abc" });

    expect(object).toEqual(TRUNCATED);
    expect(emitEvent).toHaveBeenCalledWith("quiz.feedback.truncated", { code: "abc" });
  });

  it("keeps the first verdict when the retry returns no object", async () => {
    const { grade } = gradeSequence(TRUNCATED, undefined);

    const { raw, object } = await gradeWithTruncationRetry(grade, objectOf);

    expect(object).toEqual(TRUNCATED);
    expect(raw.attempt).toBe(1);
    expect(emitEvent).toHaveBeenCalledWith("quiz.feedback.truncated", {});
  });

  it("keeps the first verdict when the retry throws — truncated-but-served beats failing", async () => {
    let call = 0;
    const grade = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("provider outage");
      return { attempt: call, object: TRUNCATED };
    });

    const { raw, object } = await gradeWithTruncationRetry(grade, objectOf);

    expect(object).toEqual(TRUNCATED);
    expect(raw.attempt).toBe(1);
    expect(emitEvent).toHaveBeenCalledWith("quiz.feedback.truncated", {});
  });

  it("does not retry when the grader returned no object at all", async () => {
    const { grade } = gradeSequence(undefined);

    const { object } = await gradeWithTruncationRetry(grade, objectOf);

    expect(grade).toHaveBeenCalledTimes(1);
    expect(object).toBeUndefined();
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
