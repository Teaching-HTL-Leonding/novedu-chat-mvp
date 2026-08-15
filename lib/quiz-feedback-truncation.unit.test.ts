import { describe, expect, it } from "vitest";
import { feedbackLooksTruncated } from "@/lib/quiz-feedback-truncation";

// The real truncations observed in the wild (issue #115): the provider's JSON grammar
// closed the `feedback` string at the model's unescaped `"` right after an opening
// backtick, leaving the code span open.
const TRUNCATED = [
  "You are right that it doesn't show up! However, you missed the explanation. The `===` operator compares strings character by character. Here, the capital **R** in `",
  "You are on the right track! To be more specific: `: number` tells TypeScript that the variable will hold a number, but `",
  "Well done! You correctly identified that `40` is a **number**. The value `",
  "Not quite! In coding, we look at the type of the value. `40` is a **number**. `",
];

describe("feedbackLooksTruncated", () => {
  it.each(TRUNCATED)("flags feedback cut off mid-code-span: %s", (feedback) => {
    expect(feedbackLooksTruncated(feedback)).toBe(true);
  });

  // The control from the same corpus: quotes INSIDE a closed span are fine, which is
  // why the detector keys on the unclosed span rather than on the quote.
  it("passes complete feedback whose code span contains quotes", () => {
    expect(feedbackLooksTruncated('Correct version:\n`case 5: message = "Fünf"; break;`')).toBe(
      false,
    );
  });

  it("passes a balanced code fence", () => {
    expect(feedbackLooksTruncated("Try:\n```typescript\nconst x = 1;\n```\nWell done!")).toBe(
      false,
    );
  });

  it("passes prose with no code span at all", () => {
    expect(feedbackLooksTruncated("Great answer, that is fully correct.")).toBe(false);
  });

  // Deliberately narrow: prose that merely ends without punctuation is NOT truncation.
  // The rejected alternative detectors flagged these and caught nothing extra.
  it("does not flag prose that simply ends without terminal punctuation", () => {
    expect(feedbackLooksTruncated("index 0 1 2 3\nvalue a b c d")).toBe(false);
  });

  it("handles empty feedback", () => {
    expect(feedbackLooksTruncated("")).toBe(false);
  });
});
