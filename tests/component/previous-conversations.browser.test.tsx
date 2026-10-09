import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The per-user tutor's "Previous conversations" dialog. Both server actions are
// mocked seams (their contract: lib/tutor-actions.unit.test.ts); this suite
// asserts what the dialog renders and hands back.

const listTutorThreads = vi.hoisted(() => vi.fn());
const openTutorThread = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tutor-actions", () => ({ listTutorThreads, openTutorThread }));

import { PreviousConversationsButton } from "@/app/_tutor/previous-conversations-button";
import type { TutorThreadSummary } from "@/lib/tutor-history-types";

const CODE = "a1b2c3d4e5";
const CURRENT = "current-thread";
const today = new Date();
today.setHours(9, 30, 0, 0);

function summary(over: Partial<TutorThreadSummary> & { threadId: string }): TutorThreadSummary {
  return {
    lastActivityAt: today,
    userMessageCount: 2,
    preview: { kind: "text", text: "What is a prime number?" },
    ...over,
  };
}

const THREADS: TutorThreadSummary[] = [
  summary({ threadId: CURRENT, preview: { kind: "text", text: "The current one" } }),
  summary({ threadId: "older-1", userMessageCount: 1 }),
  summary({ threadId: "photo-1", preview: { kind: "photo" } }),
  summary({ threadId: "empty-1", preview: { kind: "text", text: "" } }),
];

const onOpened = vi.fn();

async function openDialog() {
  const screen = await render(
    <PreviousConversationsButton code={CODE} currentThreadId={CURRENT} onOpened={onOpened} />,
  );
  const trigger = screen.getByRole("button", { name: "Previous conversations" });
  await expect.element(trigger).toHaveAttribute("title", "Previous conversations");
  await trigger.click();
  return screen;
}

beforeEach(() => {
  listTutorThreads.mockReset().mockResolvedValue({ ok: true, threads: THREADS, more: false });
  openTutorThread.mockReset();
  onOpened.mockReset();
});

test("lists the conversations with time, count and clamped preview, plus the notice", async () => {
  const screen = await openDialog();
  const dialog = screen.getByRole("dialog");

  await expect.element(dialog.getByText("Previous conversations").first()).toBeVisible();
  await expect
    .element(dialog.getByText(/This tutor is not anonymous: your teacher can see/))
    .toBeVisible();
  const rows = dialog.getByTestId("previous-conversation");
  await expect.element(rows.nth(1)).toHaveTextContent(/Today, 09:30/);
  await expect.element(rows.nth(1)).toHaveTextContent("1 message");
  await expect.element(rows.nth(0)).toHaveTextContent("2 messages");
  await expect.element(dialog.getByText("What is a prime number?")).toHaveClass(/line-clamp-2/);
  expect(listTutorThreads).toHaveBeenCalledExactlyOnceWith({ code: CODE });
});

test("the current conversation is marked and cannot be opened", async () => {
  const screen = await openDialog();
  const current = screen.getByTestId("previous-conversation").nth(0);
  await expect.element(current).toHaveTextContent("Current");
  await expect.element(current).toBeDisabled();
});

test("a photo-only and a text-less first message have their placeholders", async () => {
  const screen = await openDialog();
  await expect.element(screen.getByText("📷 Photo")).toBeVisible();
  await expect.element(screen.getByText("(no text)")).toBeVisible();
});

test("the footer appears only when there are more conversations", async () => {
  listTutorThreads.mockResolvedValue({ ok: true, threads: THREADS, more: true });
  const screen = await openDialog();
  await expect
    .element(screen.getByText("Showing your 50 most recent conversations."))
    .toBeVisible();
});

test("an empty history says so", async () => {
  listTutorThreads.mockResolvedValue({ ok: true, threads: [], more: false });
  const screen = await openDialog();
  await expect
    .element(screen.getByText("No earlier conversations with this tutor yet."))
    .toBeVisible();
});

test("a list failure offers Try again, which reloads", async () => {
  listTutorThreads.mockResolvedValueOnce({ ok: false });
  const screen = await openDialog();
  await expect.element(screen.getByText("Couldn't load your conversations.")).toBeVisible();

  await screen.getByRole("button", { name: "Try again" }).click();

  await expect.element(screen.getByText("The current one")).toBeVisible();
  expect(listTutorThreads).toHaveBeenCalledTimes(2);
});

test("opening a conversation hands back its thread and closes the dialog", async () => {
  openTutorThread.mockResolvedValue({ ok: true, threadToken: "tok-older" });
  const screen = await openDialog();

  await screen.getByTestId("previous-conversation").nth(1).click();

  await vi.waitFor(() =>
    expect(onOpened).toHaveBeenCalledExactlyOnceWith({
      threadId: "older-1",
      threadToken: "tok-older",
    }),
  );
  expect(openTutorThread).toHaveBeenCalledWith({ code: CODE, threadId: "older-1" });
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
});

test("a refused open shows the message inline and hands nothing back", async () => {
  openTutorThread.mockResolvedValue({ ok: false, message: "This conversation can't be opened." });
  const screen = await openDialog();

  await screen.getByTestId("previous-conversation").nth(1).click();

  await expect.element(screen.getByText("This conversation can't be opened.")).toBeVisible();
  expect(onOpened).not.toHaveBeenCalled();
  await expect.element(screen.getByRole("dialog")).toBeVisible();
});

test("while one row opens, the others are disabled", async () => {
  openTutorThread.mockReturnValue(new Promise(() => {}));
  const screen = await openDialog();

  await screen.getByTestId("previous-conversation").nth(1).click();

  await expect.element(screen.getByTestId("previous-conversation").nth(2)).toBeDisabled();
  await expect
    .element(screen.getByTestId("previous-conversation").nth(1))
    .toHaveAttribute("aria-busy", "true");
});
