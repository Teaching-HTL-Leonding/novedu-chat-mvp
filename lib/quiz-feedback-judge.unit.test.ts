import { describe, expect, it } from "vitest";
import {
  buildFeedbackJudgeSubject,
  FEEDBACK_JUDGE_CRITERIA,
  FEEDBACK_JUDGE_SYSTEM,
  judgmentSchema,
} from "@/lib/quiz-feedback-judge";

// GOLDEN tests for the feedback judge's three artifacts: the taxonomy, the system prompt
// the judge runs with, and the dynamic structured-output schema the kind-agnostic
// `POST /api/eval/judge` builds from the caller's criteria (docs/cli-eval.md).
//
// Purity + no-`"use server"` are enforced centrally in `lib/prompt-dump.unit.test.ts`
// (`PURE_MODULES`) and deliberately not re-asserted here.

describe("FEEDBACK_JUDGE_SYSTEM", () => {
  it("defines every criterion of the taxonomy, where the model actually reads it", () => {
    // The definitions live in the prompt, not in code comments — so the ONE way the two
    // can stay in sync is this assertion.
    for (const criterion of FEEDBACK_JUDGE_CRITERIA) {
      expect(FEEDBACK_JUDGE_SYSTEM).toContain(`"${criterion}"`);
    }
  });

  it("keeps the guardrails that hold judge noise down", () => {
    expect(FEEDBACK_JUDGE_SYSTEM).toContain("Do NOT judge the verdict itself");
    expect(FEEDBACK_JUDGE_SYSTEM).toContain("do not invent");
    expect(FEEDBACK_JUDGE_SYSTEM).toContain("When in doubt, the feedback is ok.");
  });

  it("asks for an EMPTY issues array rather than an `ok` flag", () => {
    // No `ok` boolean by design: weak judges answer `ok: false` and then name no issue,
    // which is unreportable. Flagged ⇔ an issue was named.
    expect(FEEDBACK_JUDGE_SYSTEM).toContain('EMPTY "issues"');
    expect(FEEDBACK_JUDGE_SYSTEM).not.toMatch(/\bok\b\s*(field|boolean|flag)/i);
  });
});

describe("buildFeedbackJudgeSubject", () => {
  it("lays the four inputs out in order, the standard first and the feedback last", () => {
    expect(buildFeedbackJudgeSubject("GRADE LIKE THIS", "my answer", "partial", "Almost!")).toBe(
      [
        "=== The system prompt the grader was given ===",
        "GRADE LIKE THIS",
        "",
        "=== The student's answer ===",
        "my answer",
        "",
        "=== The grader's verdict ===",
        "partial",
        "",
        "=== The grader's feedback (JUDGE THIS) ===",
        "Almost!",
      ].join("\n"),
    );
  });

  it("passes every part through verbatim — it is data for the judge, not markup", () => {
    const subject = buildFeedbackJudgeSubject(
      "=== not a real header ===\n$& $' backslash \\n",
      "answer\nwith lines",
      "incorrect",
      "**bold** | piped",
    );

    expect(subject).toContain("=== not a real header ===\n$& $' backslash \\n");
    expect(subject).toContain("answer\nwith lines");
    expect(subject).toContain("**bold** | piped");
  });
});

describe("judgmentSchema", () => {
  it("accepts an empty issues list — the way the judge says 'this feedback is fine'", () => {
    expect(judgmentSchema(FEEDBACK_JUDGE_CRITERIA).parse({ issues: [] })).toEqual({ issues: [] });
  });

  it("accepts every criterion of the taxonomy it was built from", () => {
    const schema = judgmentSchema(FEEDBACK_JUDGE_CRITERIA);

    for (const criterion of FEEDBACK_JUDGE_CRITERIA) {
      expect(schema.safeParse({ issues: [{ criterion, note: "n" }] }).success).toBe(true);
    }
  });

  it("REJECTS a criterion outside the caller's taxonomy", () => {
    const schema = judgmentSchema(FEEDBACK_JUDGE_CRITERIA);

    expect(schema.safeParse({ issues: [{ criterion: "too_wordy", note: "n" }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ issues: [{ criterion: "leaks_rubric" }] }).success).toBe(false);
  });

  it("is built from the CALLER's criteria, so a future eval kind brings its own", () => {
    // The property that keeps `POST /api/eval/judge` kind-agnostic: the enum comes from
    // the request, never from this module's quiz taxonomy.
    const tutorish = judgmentSchema(["breaks_persona", "solves_for_the_student"]);

    expect(
      tutorish.safeParse({ issues: [{ criterion: "breaks_persona", note: "n" }] }).success,
    ).toBe(true);
    expect(tutorish.safeParse({ issues: [{ criterion: "leaks_rubric", note: "n" }] }).success).toBe(
      false,
    );
  });
});
