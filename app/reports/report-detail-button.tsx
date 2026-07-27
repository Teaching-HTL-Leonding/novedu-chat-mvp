"use client";

import Link from "next/link";
import { type ComponentProps, type ReactNode, useState } from "react";
import { LocalTime } from "@/app/local-time";
import { MarkdownRenderer } from "@/app/markdown-renderer";
import { EyeIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DIALOG_BODY, DialogShell } from "@/components/ui/dialog-shell";
import { iconButtonVariants } from "@/components/ui/icon-button";
import { type QuizVerdict, verdictLabel } from "@/lib/quiz-types";
import { REPORT_REACTION_LABELS, type ReportReaction } from "@/lib/report-types";

// The teacher-facing "view details" affordance for one inbox row: an eye
// icon-button that opens a DialogShell with the full report. The whole snapshot
// already rides on the row (a report is self-contained — the quiz grader persists
// nothing), so this is a dialog, not a `/reports/[id]` route. Props are PLAIN
// serializable values passed from the server page — no React elements, no Dates.
//
// Trust boundary inside the dialog: the quiz QUESTION text (server-authoritative)
// and the FEEDBACK go through the sanitized MarkdownRenderer, but the STUDENT'S
// ANSWER is untrusted free text and renders as plain `whitespace-pre-wrap` — NEVER
// through markdown (no rehype-raw path can touch it).

type BadgeTone = NonNullable<ComponentProps<typeof Badge>["tone"]>;

// Reaction → badge tone (plan step 1): good→green, omg→purple, bad→orange,
// holysh→red solid (the urgent tier stands out). One definition shared by the
// inbox column (via <ReactionBadge>) and this dialog.
const REACTION_BADGE: Record<ReportReaction, { tone: BadgeTone; solid: boolean }> = {
  good: { tone: "green", solid: false },
  omg: { tone: "purple", solid: false },
  bad: { tone: "orange", solid: false },
  holysh: { tone: "red", solid: true },
};

/** The reaction pill used in both the inbox column and the detail dialog. */
export function ReactionBadge({ reaction }: { reaction: ReportReaction }) {
  const { tone, solid } = REACTION_BADGE[reaction];
  return (
    <Badge tone={tone} solid={solid} caps>
      {REPORT_REACTION_LABELS[reaction]}
    </Badge>
  );
}

/** The plain, serializable report shape the server page hands to the dialog. */
export interface ReportDetail {
  kind: "chat" | "quiz-answer";
  reaction: ReportReaction;
  resolved: boolean;
  createdSeconds: number;
  /** The reporter's display name (falls back to the oid). */
  reporter: string;
  /** The reporter's Entra oid — shown as a hover title on the name. */
  reporterId: string;
  description: string;
  code: string;
  codeNote: string | null;
  /** chat only. */
  threadId: string | null;
  /** quiz only. */
  questionText: string | null;
  answerText: string | null;
  feedbackText: string | null;
  verdict: QuizVerdict | null;
  hadImages: boolean;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <dt className="font-semibold text-foreground/60 text-xs uppercase tracking-wide">{children}</dt>
  );
}

export function ReportDetailButton({ report }: { report: ReportDetail }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={iconButtonVariants()}
        onClick={() => setOpen(true)}
        aria-label="View report details"
        title="View details"
      >
        <EyeIcon />
      </button>
      <DialogShell
        open={open}
        onClose={() => setOpen(false)}
        className="h-auto max-h-[85vh]"
        title="Report details"
      >
        <div className={DIALOG_BODY}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <FieldLabel>Reaction</FieldLabel>
            <dd>
              <ReactionBadge reaction={report.reaction} />
            </dd>
            <FieldLabel>Status</FieldLabel>
            <dd>
              <Badge tone={report.resolved ? "green" : "orange"} caps>
                {report.resolved ? "resolved" : "open"}
              </Badge>
            </dd>
            <FieldLabel>Reported</FieldLabel>
            <dd>
              <LocalTime seconds={report.createdSeconds} />
            </dd>
            <FieldLabel>Student</FieldLabel>
            <dd title={report.reporterId}>{report.reporter}</dd>
            <FieldLabel>Code</FieldLabel>
            <dd>
              <Link href={`/codes/${report.code}`} className="underline">
                {report.codeNote || report.code}
              </Link>
            </dd>
          </dl>

          {report.description ? (
            <section className="mt-5">
              <FieldLabel>Description</FieldLabel>
              <p className="mt-1 whitespace-pre-wrap text-sm">{report.description}</p>
            </section>
          ) : null}

          {report.kind === "quiz-answer" ? (
            <section className="mt-5 space-y-4 border-foreground/10 border-t pt-4">
              {report.questionText != null ? (
                <div>
                  <FieldLabel>Question</FieldLabel>
                  {/* Server-authoritative, teacher-authored — sanitized markdown. */}
                  <MarkdownRenderer content={report.questionText} className="mt-1 text-sm" />
                </div>
              ) : null}
              <div>
                <FieldLabel>
                  Student answer
                  {report.verdict ? ` — graded ${verdictLabel(report.verdict)}` : ""}
                </FieldLabel>
                {/* UNTRUSTED student text — plain, NEVER markdown. */}
                <p className="mt-1 whitespace-pre-wrap text-sm">{report.answerText || "—"}</p>
                {report.hadImages ? (
                  <p className="mt-1 text-foreground/60 text-xs italic">
                    Answer included photos (not stored).
                  </p>
                ) : null}
              </div>
              {report.feedbackText ? (
                <div>
                  <FieldLabel>AI feedback</FieldLabel>
                  <MarkdownRenderer content={report.feedbackText} className="mt-1 text-sm" />
                </div>
              ) : null}
            </section>
          ) : null}

          {report.kind === "chat" && report.threadId ? (
            <section className="mt-5 border-foreground/10 border-t pt-4">
              <Link
                href={`/codes/${report.code}/c/${report.threadId}?from=reports`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open transcript
              </Link>
            </section>
          ) : null}
        </div>
      </DialogShell>
    </>
  );
}
