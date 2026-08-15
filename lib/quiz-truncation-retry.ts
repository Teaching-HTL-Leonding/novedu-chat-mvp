import { feedbackLooksTruncated } from "@/lib/quiz-feedback-truncation";
import type { QuizVerdict } from "@/lib/quiz-types";
import { emitEvent } from "@/lib/telemetry";

// The ONE implementation of the issue-#115 mitigation both graders share — the student
// path (`lib/quiz-actions.ts` `submitAnswer`) and the teacher-only eval route
// (`app/api/eval/grade`). Deliberately identical by construction: an eval must measure
// what a student would actually have been shown.
//
// SERVER-ONLY (imports the telemetry seam) and NOT `"use server"` — a plain module, so
// nothing here becomes an endpoint.

/** The structured verdict a grading call produces (`QUIZ_VERDICT_SCHEMA`). */
export interface GradedVerdict {
  result: QuizVerdict;
  feedback: string;
}

/**
 * Grade once; when the feedback looks cut off mid-inline-code (`feedbackLooksTruncated`,
 * issue #115), grade ONE more time — the truncation is a provider-side artefact of the
 * JSON grammar, not a bad answer, and one more sample usually lands clean.
 *
 * The verdict already in hand is never lost to the retry: a retry that throws, or
 * returns no object, keeps the first attempt — a truncated-but-served feedback beats
 * refusing to grade. When the SERVED feedback is still truncated, the
 * `quiz.feedback.truncated` event (with `event` as its payload) makes the recurrence
 * visible; nothing else changes.
 *
 * `raw` is the attempt the served `object` came from, so a caller can derive
 * call-level detail (the eval route's token usage) from the matching result.
 */
export async function gradeWithTruncationRetry<R>(
  grade: () => Promise<R>,
  objectOf: (result: R) => GradedVerdict | undefined,
  event: Record<string, string> = {},
): Promise<{ raw: R; object: GradedVerdict | undefined }> {
  let raw = await grade();
  let object = objectOf(raw);
  if (object && feedbackLooksTruncated(object.feedback)) {
    try {
      const retried = await grade();
      const retriedObject = objectOf(retried);
      if (retriedObject) {
        raw = retried;
        object = retriedObject;
      }
    } catch {
      // Keep the first verdict — see the header.
    }
    if (feedbackLooksTruncated(object.feedback)) emitEvent("quiz.feedback.truncated", event);
  }
  return { raw, object };
}
