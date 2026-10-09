import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
// The component project loads no global CSS — the overflow measurement below
// needs the real utilities or the UA stylesheet answers it vacuously (see
// docs/testing.md).
import "@/app/globals.css";

vi.mock("next/link", () => import("@/tests/mocks/next-link"));

import { type ReportDetail, ReportDetailButton } from "@/app/reports/report-detail-button";

// The teacher-facing report-detail dialog shows UNTRUSTED student text
// (description, quiz answer) plus markdown-rendered question/feedback. A long
// unbroken token must wrap inside the dialog: unwrapped it would widen the
// content to thousands of px, and DIALOG_BODY's `overflow-y-auto` (which computes
// overflow-x to auto) would show a horizontal scrollbar. `wrap-anywhere` keeps
// the body's scrollWidth at its clientWidth, asserted on real CSS in a real browser.

// Long enough that, unwrapped, it dwarfs the 48rem dialog.
const LONG_TOKEN = "A".repeat(400);

const baseReport: ReportDetail = {
  kind: "quiz-answer",
  reaction: "bad",
  resolved: false,
  createdSeconds: 1_756_100_000,
  reporter: "Student Name",
  reporterId: "oid-1",
  description: `description ${LONG_TOKEN}`,
  code: "abc123",
  codeNote: null,
  threadId: null,
  questionText: `question ${LONG_TOKEN}`,
  answerText: `answer **not markdown** ${LONG_TOKEN}`,
  feedbackText: `feedback ${LONG_TOKEN}`,
  verdict: "incorrect",
  hadImages: false,
};

async function openDialog(report: ReportDetail) {
  // The real mount point: the /reports list renders this button (and thus the
  // dialog, a DOM sibling) inside the actions cell, which is `whitespace-nowrap`.
  // The top layer does not break inheritance, so the dialog shell must reset it
  // to `whitespace-normal` or no prose wraps.
  const screen = await render(
    <div className="whitespace-nowrap">
      <ReportDetailButton report={report} />
    </div>,
  );
  await screen.getByRole("button", { name: "View report details" }).click();
  const dialog = screen.container.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.open).toBe(true);
  const body = dialog.querySelector(".overflow-y-auto") as HTMLElement;
  expect(body).not.toBeNull();
  return { screen, dialog, body };
}

test("long unbroken student text wraps — the dialog body never scrolls horizontally", async () => {
  const { body } = await openDialog(baseReport);

  // Every field carries the long token (plain paragraphs AND the markdown
  // question/feedback); all of it must wrap inside the body's width.
  expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
});

test("the student's answer renders as PLAIN text, never through markdown", async () => {
  const { screen } = await openDialog(baseReport);

  // The literal `**not markdown**` must survive: the answer is untrusted free
  // text and bypasses the markdown pipeline by design (trust boundary in
  // report-detail-button.tsx).
  await expect.element(screen.getByText(/answer \*\*not markdown\*\*/)).toBeVisible();
});
