// Client-safe quiz types and the verdict→label mapping. PURE — no imports, no
// I/O, no YAML parser, no node:crypto — so a client component (the quiz runner)
// can import the student-facing types and `verdictLabel` without pulling the
// YAML parser into the browser bundle. The richer, server-only types and the
// lenient parser live in `lib/quiz-yaml.ts`.

// The grader's internal verdict vocabulary. Kept terse for the structured-output
// schema; the student never sees these raw values (see `verdictLabel`).
export type QuizVerdict = "correct" | "partial" | "incorrect";

/** The student-facing wording for a verdict — `partial` reads as "partly correct". */
export function verdictLabel(verdict: QuizVerdict): string {
  switch (verdict) {
    case "correct":
      return "correct";
    case "partial":
      return "partly correct";
    case "incorrect":
      return "wrong";
  }
}

/** A single question as shipped to the browser — NEVER carries the `evaluation` prompt. */
export interface QuizQuestionPublic {
  id: string;
  /** Optional short label for progress display. */
  title?: string;
  /** MARKDOWN shown to the student. */
  question: string;
}

/** The student-facing projection of a quiz — everything the runner needs, nothing more. */
export interface QuizPublic {
  id: string;
  /** Optional welcome-screen title. */
  title?: string;
  /** Optional welcome-screen description (markdown). */
  description?: string;
  /** Present questions in a random order per attempt. */
  shuffle: boolean;
  questions: QuizQuestionPublic[];
}
