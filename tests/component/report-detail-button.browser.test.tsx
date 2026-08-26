import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
// The component project loads no global CSS — the overflow measurement below
// needs the real utilities or the UA stylesheet answers it vacuously (see
// docs/testing.md).
import "@/app/globals.css";

// next/link reads Next-server globals that don't exist in the browser test
// runner; the dialog renders plain code / transcript links.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { type ReportDetail, ReportDetailButton } from "@/app/reports/report-detail-button";

// The teacher-facing report-detail dialog shows UNTRUSTED student text
// (description, quiz answer) plus markdown-rendered question/feedback. A long
// unbroken token used to blow the content out to ~3600px and hand the modal a
// horizontal scrollbar (DIALOG_BODY's `overflow-y-auto` computes overflow-x
// to auto) — the shipped bug this file pins. The fix is `wrap-anywhere` on
// DIALOG_BODY, so the geometry is asserted here where it regressed, on real
// CSS in a real browser.

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
  // dialog, a DOM sibling) inside the actions cell, which is
  // `whitespace-nowrap` — and the top layer does NOT break inheritance, so
  // without the shell's `whitespace-normal` reset the whole dialog inherits
  // nowrap and no prose wraps at all (the second shipped bug this file pins).
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
