// Detector for the silent grader-feedback truncation of issue #115.
//
// The provider's JSON grammar (vLLM guided decoding) accepts a raw `"` inside a string
// value as the string TERMINATOR. When the grading model writes an inline code span
// around a quoted literal (`"lightblue"`) it emits that quote unescaped, the `feedback`
// string closes early, and the surrounding object stays well-formed — so the response
// parses cleanly and the truncation is invisible to every layer below.
//
// The tell is the code span the model opened and never closed: an ODD number of
// backticks. Over the 572-string corpus that first surfaced this, it flagged all real
// truncations with zero false positives, and it beat both alternatives considered
// ("ends without terminal punctuation", "ends in a whitespace run"), which produced
// false positives on ASCII-art diagrams and caught nothing extra.
//
// Steering the model away from the trigger ("single quotes inside inline code") is
// COURSE material, not platform frame — a course whose subject invites quoted literals
// carries the instruction in its own quiz fragment library (the TypeScript course does),
// where it reads naturally next to the other course rules and never confuses a grader in
// an unrelated subject. Platform-side, this detector plus the one-retry in
// `lib/quiz-truncation-retry.ts` are the backstop that makes a recurrence VISIBLE rather
// than silent.
//
// PURE: no I/O, no `"use server"`, no `app/`, no DB. Keep it that way.

/**
 * True when `feedback` looks like it was cut off mid-inline-code — the signature of a
 * grading response truncated by the provider's JSON grammar.
 *
 * Deliberately narrow: it answers "was a code span left open", not "is this text
 * complete". Prose that simply ends without punctuation is not flagged.
 */
export function feedbackLooksTruncated(feedback: string): boolean {
  return (feedback.match(/`/g)?.length ?? 0) % 2 === 1;
}
