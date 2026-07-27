// Client-safe vocabulary for the "report conversation / AI answer" feature (GH
// issue #24). PURE — no I/O, no server imports — so both the student-facing
// report button (a client component) and the server-side store/actions share
// ONE definition of the reaction scale, the report kinds, and the size/soft-cap
// limits. The richer, server-only report row + store live in `lib/report-*.ts`.

/**
 * The fixed four-level reaction scale a student picks when reporting. Order is
 * the display order (best → most urgent); `holysh` is the urgent tier, styled
 * distinctly in the teacher UI. Stored verbatim in `novedu_reports.reaction`.
 */
export const REPORT_REACTIONS = ["good", "omg", "bad", "holysh"] as const;

export type ReportReaction = (typeof REPORT_REACTIONS)[number];

/** Narrows an untrusted value (form input) to a known reaction. */
export function isReportReaction(value: unknown): value is ReportReaction {
  return (REPORT_REACTIONS as readonly unknown[]).includes(value);
}

/** The student-facing label for each reaction. */
export const REPORT_REACTION_LABELS: Record<ReportReaction, string> = {
  good: "Good",
  omg: "OMG",
  bad: "Bad",
  holysh: "Holy sh..",
};

/**
 * What a report targets: a chat conversation (any of the three chat surfaces) or
 * a single graded quiz answer. The discriminator on `novedu_reports.kind`.
 */
export type ReportKind = "chat" | "quiz-answer";

/** Upper bound on the optional free-text description (chars). */
export const REPORT_DESCRIPTION_MAX = 2000;

/** Soft cap on reports per target — per (thread, user) / (code, user, question). */
export const MAX_REPORTS_PER_TARGET = 3;
