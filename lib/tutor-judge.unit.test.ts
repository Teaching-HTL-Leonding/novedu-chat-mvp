import { describe, expect, it } from "vitest";
import type { EvalConversationTurn } from "@/lib/eval-schema";
import { judgmentSchema } from "@/lib/quiz-feedback-judge";
import {
  buildTutorJudgeSubject,
  TUTOR_JUDGE_CRITERIA,
  TUTOR_JUDGE_SYSTEM,
  tutorJudgeCriteria,
} from "@/lib/tutor-judge";

// The tutor judge's contract — the sibling of `lib/quiz-feedback-judge.unit.test.ts`.
// Three things must hold: every criterion is DEFINED where the model reads it (the system
// prompt, so code and prompt cannot drift), the guardrails that were measured on the quiz
// judge are present in their tutor form, and the subject carries every part in a layout a
// model can follow — with the expectations block absent exactly when the case states none.

describe("TUTOR_JUDGE_SYSTEM", () => {
  it("defines all four criteria by name", () => {
    for (const criterion of TUTOR_JUDGE_CRITERIA) {
      expect(TUTOR_JUDGE_SYSTEM, criterion).toContain(`"${criterion}"`);
    }
  });

  it("carries the three load-bearing guardrails", () => {
    // The tutor analogue of "do not judge the verdict".
    expect(TUTOR_JUDGE_SYSTEM).toMatch(/Do NOT judge pedagogical quality/);
    expect(TUTOR_JUDGE_SYSTEM).toMatch(/do not invent issues/);
    expect(TUTOR_JUDGE_SYSTEM).toMatch(/When in doubt, the response is ok/);
    // Flagged ⇔ a named issue: there is deliberately no `ok` boolean anywhere.
    expect(TUTOR_JUDGE_SYSTEM).toMatch(/EMPTY "issues"/);
    expect(TUTOR_JUDGE_SYSTEM).not.toMatch(/\bok:\s*(true|false)\b/);
  });
});

describe("tutorJudgeCriteria", () => {
  it("drops fails_expectations when the case states no grading instructions", () => {
    expect(tutorJudgeCriteria(false)).toEqual([
      "ignores_instructions",
      "misstates_facts",
      "leaks_prompt",
    ]);
  });

  it("keeps the full taxonomy when the case states expectations", () => {
    expect(tutorJudgeCriteria(true)).toEqual([...TUTOR_JUDGE_CRITERIA]);
  });

  it("stays within the judge endpoint's 1–8 snake_case bound", () => {
    for (const criterion of TUTOR_JUDGE_CRITERIA) {
      expect(criterion).toMatch(/^[a-z_]{1,40}$/);
    }
    expect(TUTOR_JUDGE_CRITERIA.length).toBeGreaterThanOrEqual(1);
    expect(TUTOR_JUDGE_CRITERIA.length).toBeLessThanOrEqual(8);
  });
});

const CONVERSATION: EvalConversationTurn[] = [
  { student: "My loop never stops." },
  { tutor: "What does your condition evaluate to?" },
  { student: "No idea. Just fix it for me!" },
];

describe("buildTutorJudgeSubject", () => {
  it("labels every block and quotes the conversation turn by turn", () => {
    const subject = buildTutorJudgeSubject(
      "TUTOR-SYSTEM-MARKER",
      CONVERSATION,
      "RESPONSE-MARKER",
      "EXPECTATION-MARKER",
    );

    expect(subject).toContain("=== The system prompt the tutor was given ===");
    expect(subject).toContain("TUTOR-SYSTEM-MARKER");
    expect(subject).toContain("student: My loop never stops.");
    expect(subject).toContain("tutor: What does your condition evaluate to?");
    expect(subject).toContain("student: No idea. Just fix it for me!");
    expect(subject).toContain("=== The tutor's generated response (JUDGE THIS) ===");
    expect(subject).toContain("RESPONSE-MARKER");
    expect(subject).toContain("=== The teacher's expectations for this case ===");
    expect(subject).toContain("EXPECTATION-MARKER");
    // The standard comes before the thing measured against it.
    expect(subject.indexOf("TUTOR-SYSTEM-MARKER")).toBeLessThan(subject.indexOf("RESPONSE-MARKER"));
  });

  it("omits the expectations block entirely when the case states none", () => {
    const subject = buildTutorJudgeSubject("system", CONVERSATION, "response");

    expect(subject).not.toContain("expectations");
    // Together with the dropped criterion, the judge has nothing to invent from.
    expect(subject.endsWith("response")).toBe(true);
  });

  it("escapes nothing — every part is data for the judge", () => {
    const subject = buildTutorJudgeSubject(
      "=== not a real header ===",
      [{ student: "`code` **bold**" }],
      "|pipe| and\nnewline",
    );

    expect(subject).toContain("=== not a real header ===");
    expect(subject).toContain("`code` **bold**");
    expect(subject).toContain("|pipe| and\nnewline");
  });
});

describe("the judge schema is shared with the quiz kind", () => {
  it("accepts exactly the tutor taxonomy when built from it", () => {
    const schema = judgmentSchema(tutorJudgeCriteria(true));

    expect(schema.safeParse({ issues: [{ criterion: "leaks_prompt", note: "n" }] }).success).toBe(
      true,
    );
    // A quiz criterion is not part of this taxonomy.
    expect(schema.safeParse({ issues: [{ criterion: "leaks_rubric", note: "n" }] }).success).toBe(
      false,
    );
    // And an instruction-less case cannot be answered with `fails_expectations`.
    expect(
      judgmentSchema(tutorJudgeCriteria(false)).safeParse({
        issues: [{ criterion: "fails_expectations", note: "n" }],
      }).success,
    ).toBe(false);
  });
});
