import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { REPORT_DESCRIPTION_MAX } from "@/lib/report-types";

// The one student-facing report control (GH issue #24). PURE interaction (the two
// server actions are mocked): the trigger opens the dialog, the mandatory
// attribution notice is shown, submit is gated on a reaction, each target kind
// dispatches to the right action with the right payload, and the success/error
// states render. The wired submit paths are covered by lib/report-actions unit
// tests + the @live e2e.

const { submitChatReport, submitQuizReport } = vi.hoisted(() => ({
  submitChatReport: vi.fn(),
  submitQuizReport: vi.fn(),
}));

vi.mock("@/lib/report-actions", () => ({ submitChatReport, submitQuizReport }));

import { ReportButton, type ReportTarget } from "@/components/report-button";

const chatTarget: ReportTarget = {
  kind: "chat",
  code: "ABC123",
  threadId: "thread-1",
  threadToken: "token-xyz",
};

const quizTarget: ReportTarget = {
  kind: "quiz-answer",
  code: "QUIZ99",
  questionId: "q-1",
  answer: "42",
  result: "partial",
  feedback: "Close, but…",
  hadImages: true,
};

beforeEach(() => {
  submitChatReport.mockReset().mockResolvedValue({ ok: true });
  submitQuizReport.mockReset().mockResolvedValue({ ok: true });
});

describe("ReportButton", () => {
  test("the trigger opens the dialog with the reaction options", async () => {
    const screen = await render(<ReportButton target={chatTarget} />);

    const dialog = screen.container.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(false);

    await screen.getByRole("button", { name: "Report", exact: true }).click();
    expect(dialog.open).toBe(true);
    await expect.element(screen.getByRole("button", { name: "Good" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Holy sh.." })).toBeVisible();
  });

  test("shows the mandatory attribution notice worded for a chat target", async () => {
    const screen = await render(<ReportButton target={chatTarget} />);
    await screen.getByRole("button", { name: "Report", exact: true }).click();
    await expect
      .element(screen.getByText(/Reports are not anonymous.*conversation/i))
      .toBeVisible();
  });

  test("shows the mandatory attribution notice worded for a quiz target", async () => {
    const screen = await render(<ReportButton target={quizTarget} />);
    await screen.getByRole("button", { name: "Report", exact: true }).click();
    await expect.element(screen.getByText(/Reports are not anonymous.*answer/i)).toBeVisible();
  });

  test("submit is disabled until a reaction is picked", async () => {
    const screen = await render(<ReportButton target={chatTarget} />);
    await screen.getByRole("button", { name: "Report", exact: true }).click();

    const submit = screen.getByRole("button", { name: "Send report" });
    await expect.element(submit).toBeDisabled();

    await screen.getByRole("button", { name: "Bad" }).click();
    await expect.element(submit).toBeEnabled();
  });

  test("chat target: submit calls submitChatReport with the token payload", async () => {
    const screen = await render(<ReportButton target={chatTarget} />);
    await screen.getByRole("button", { name: "Report", exact: true }).click();

    await screen.getByRole("button", { name: "Good" }).click();
    await screen.getByRole("textbox").fill("the bot was great");
    await screen.getByRole("button", { name: "Send report" }).click();

    await vi.waitFor(() => expect(submitChatReport).toHaveBeenCalledTimes(1));
    expect(submitChatReport).toHaveBeenCalledWith({
      code: "ABC123",
      threadId: "thread-1",
      threadToken: "token-xyz",
      reaction: "good",
      description: "the bot was great",
    });
    expect(submitQuizReport).not.toHaveBeenCalled();
  });

  test("quiz target: submit calls submitQuizReport with the answer snapshot", async () => {
    const screen = await render(<ReportButton target={quizTarget} />);
    await screen.getByRole("button", { name: "Report", exact: true }).click();

    await screen.getByRole("button", { name: "Holy sh.." }).click();
    await screen.getByRole("textbox").fill("graded wrong");
    await screen.getByRole("button", { name: "Send report" }).click();

    await vi.waitFor(() => expect(submitQuizReport).toHaveBeenCalledTimes(1));
    expect(submitQuizReport).toHaveBeenCalledWith({
      code: "QUIZ99",
      questionId: "q-1",
      answer: "42",
      result: "partial",
      feedback: "Close, but…",
      hadImages: true,
      reaction: "holysh",
      description: "graded wrong",
    });
    expect(submitChatReport).not.toHaveBeenCalled();
  });

  test("success shows a thank-you with only a Close affordance, no 'report again'", async () => {
    const screen = await render(<ReportButton target={chatTarget} />);
    const dialog = screen.container.querySelector("dialog") as HTMLDialogElement;
    await screen.getByRole("button", { name: "Report", exact: true }).click();
    await screen.getByRole("button", { name: "Good" }).click();
    await screen.getByRole("button", { name: "Send report" }).click();

    await expect.element(screen.getByText(/Thanks — your teacher will take a look/i)).toBeVisible();

    // No in-dialog "report again" affordance, and the form is gone.
    await expect
      .element(screen.getByRole("button", { name: "Send another report" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Send report" }))
      .not.toBeInTheDocument();

    // The dialog is still closable via the shell's header Close button.
    await screen.getByRole("button", { name: "Close" }).click();
    expect(dialog.open).toBe(false);
  });

  test("a failed submit shows the server message", async () => {
    submitChatReport.mockResolvedValue({ ok: false, message: "Could not submit right now." });
    const screen = await render(<ReportButton target={chatTarget} />);
    await screen.getByRole("button", { name: "Report", exact: true }).click();
    await screen.getByRole("button", { name: "Good" }).click();
    await screen.getByRole("button", { name: "Send report" }).click();

    await expect.element(screen.getByText("Could not submit right now.")).toBeVisible();
    // The form stays (no thank-you), so the student can retry.
    await expect.element(screen.getByRole("button", { name: "Send report" })).toBeVisible();
  });

  test("the description textarea caps at REPORT_DESCRIPTION_MAX with a live counter", async () => {
    const screen = await render(<ReportButton target={chatTarget} />);
    await screen.getByRole("button", { name: "Report", exact: true }).click();

    const textarea = screen.getByRole("textbox");
    await expect.element(textarea).toHaveAttribute("maxlength", String(REPORT_DESCRIPTION_MAX));
    await expect.element(screen.getByText(`0 / ${REPORT_DESCRIPTION_MAX}`)).toBeVisible();

    await textarea.fill("hello");
    await expect.element(screen.getByText(`5 / ${REPORT_DESCRIPTION_MAX}`)).toBeVisible();
  });
});
