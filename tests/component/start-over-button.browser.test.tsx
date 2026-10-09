import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The two Start-over wordings: what starting over costs differs between an
// anonymous tutor (gone for good) and a per-user one (reopenable).

vi.mock("@/lib/tutor-actions", () => ({ startNewTutorThread: vi.fn() }));

import { StartOverButton } from "@/app/_tutor/start-over-button";

async function openConfirm(historyEnabled: boolean) {
  const screen = await render(
    <StartOverButton code="a1b2c3d4e5" historyEnabled={historyEnabled} onStarted={vi.fn()} />,
  );
  // The toolbar control is the same in both.
  const trigger = screen.getByRole("button", { name: "Start over" });
  await expect.element(trigger).toHaveAttribute("title", "Start over");
  await trigger.click();
  return screen.getByRole("dialog");
}

test("anonymous tutor: gone for good, the teacher cannot see whose it was", async () => {
  const dialog = await openConfirm(false);
  await expect.element(dialog.getByText("Start over?")).toBeVisible();
  await expect
    .element(dialog.getByText(/you cannot come back to this conversation later/))
    .toBeVisible();
  await expect.element(dialog.getByText(/cannot see that it was yours/)).toBeVisible();
  await expect.element(dialog.getByRole("button", { name: "Start over" })).toBeVisible();
});

test("per-user tutor: saved and reopenable under Previous conversations", async () => {
  const dialog = await openConfirm(true);
  await expect.element(dialog.getByText("Start a new conversation?")).toBeVisible();
  await expect.element(dialog.getByText(/reopen it under Previous conversations/)).toBeVisible();
  await expect.element(dialog.getByText(/Your teacher can see both conversations/)).toBeVisible();
  await expect
    .element(dialog.getByRole("button", { name: "Start new conversation" }))
    .toBeVisible();
});
